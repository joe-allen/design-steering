import { beforeEach, describe, expect, test, vi } from 'vitest';
import { disk } from '../test/fake-store.js';

vi.mock('@tauri-apps/plugin-store', async () => import('../test/fake-store.js'));

const {
  DEFAULT_SETTINGS,
  forgetPage,
  loadCritiqueLayout,
  loadLastPage,
  loadSettings,
  rememberPage,
  saveCritiqueLayout,
  saveSettings,
} = await import('./settings.js');

beforeEach(() => disk.clear());

describe('settings store', () => {
  test('first launch: empty token and Node path, images on, author off, no page or run name', async () => {
    expect(await loadSettings()).toEqual({ token: '', images: true, user: false, nodePath: '' });
    expect(await loadLastPage()).toBe('');
    expect(await loadCritiqueLayout()).toBe('single');
  });

  test('save then reload restores every value', async () => {
    const saved = { token: 'figd_abc', images: false, user: true, nodePath: '/usr/local/bin/node' };
    await saveSettings(saved);
    expect(await loadSettings()).toEqual(saved);
  });

  test('clearing the token removes it from the file', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, token: 'figd_abc' });
    await saveSettings({ ...DEFAULT_SETTINGS, token: '' });
    expect(disk.has('token')).toBe(false);
    expect([...disk.values()]).not.toContain('figd_abc');
    expect((await loadSettings()).token).toBe('');
  });

  test('saving Settings leaves the remembered page intact', async () => {
    await rememberPage('https://www.figma.com/design/K/f?node-id=1-1');
    await saveSettings({ ...DEFAULT_SETTINGS, token: 'figd_abc', images: false });
    expect(await loadLastPage()).toBe('https://www.figma.com/design/K/f?node-id=1-1');
  });

  test('a stray runName key is never loaded as a setting', async () => {
    disk.set('runName', 'old');
    expect(await loadSettings()).not.toHaveProperty('runName');
  });

  test('forgetting the page removes only that key', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, token: 'figd_abc' });
    await rememberPage('https://figma.test/p');
    await forgetPage();
    expect(disk.has('pageUrl')).toBe(false);
    expect(await loadLastPage()).toBe('');
    expect((await loadSettings()).token).toBe('figd_abc');
  });

  test('layout preferences round-trip independently of Settings and the remembered page', async () => {
    await saveCritiqueLayout('grid');
    await rememberPage('https://figma.test/p');
    await saveSettings({ ...DEFAULT_SETTINGS, token: 'figd_abc' });
    await forgetPage();

    expect(await loadCritiqueLayout()).toBe('grid');
    expect(await loadSettings()).not.toHaveProperty('critiqueLayout');
    expect((await loadSettings()).token).toBe('figd_abc');

    await saveCritiqueLayout('single');
    expect(await loadCritiqueLayout()).toBe('single');
  });

  test('unsupported layout values are reported rather than silently accepted', async () => {
    disk.set('critiqueLayout', 'sideways');
    await expect(loadCritiqueLayout()).rejects.toThrow('Unknown critique layout');
    await expect(saveCritiqueLayout('sideways')).rejects.toThrow('Unknown critique layout');
  });
});
