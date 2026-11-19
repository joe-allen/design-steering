import { load } from '@tauri-apps/plugin-store';

const FILE = 'settings.json';
const PAGE_KEY = 'pageUrl';
const LAYOUT_KEY = 'critiqueLayout';

export const DEFAULT_SETTINGS = Object.freeze({
  token: '',
  images: true,
  user: false,
  nodePath: '',
});

export async function loadSettings() {
  const store = await load(FILE, { autoSave: false });
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = await store.get(key);
    if (value !== undefined && value !== null) settings[key] = value;
  }
  return settings;
}

// Writes only the Settings keys, leaving page and layout preferences intact.
export async function saveSettings(settings) {
  const store = await load(FILE, { autoSave: false });
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    // An empty token is removed from the file rather than stored as an empty string.
    if (key === 'token' && !settings.token) await store.delete('token');
    else await store.set(key, settings[key]);
  }
  await store.save();
}

/** The last page URL used for a run started from the Comments form. */
export async function loadLastPage() {
  const store = await load(FILE, { autoSave: false });
  return (await store.get(PAGE_KEY)) ?? '';
}

export async function rememberPage(url) {
  const store = await load(FILE, { autoSave: false });
  await store.set(PAGE_KEY, url);
  await store.save();
}

export async function forgetPage() {
  const store = await load(FILE, { autoSave: false });
  await store.delete(PAGE_KEY);
  await store.save();
}

function validateCritiqueLayout(layout) {
  if (layout !== 'single' && layout !== 'grid') {
    throw new Error('Unknown critique layout. Choose single or grid.');
  }
  return layout;
}

export async function loadCritiqueLayout() {
  const store = await load(FILE, { autoSave: false });
  return validateCritiqueLayout((await store.get(LAYOUT_KEY)) ?? 'single');
}

export async function saveCritiqueLayout(layout) {
  validateCritiqueLayout(layout);
  const store = await load(FILE, { autoSave: false });
  await store.set(LAYOUT_KEY, layout);
  await store.save();
}
