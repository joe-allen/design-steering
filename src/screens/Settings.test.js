import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { disk } from '../test/fake-store.js';

vi.mock('@tauri-apps/plugin-store', async () => import('../test/fake-store.js'));
vi.mock('../lib/api.js', () => ({ appVersion: vi.fn(), detectNode: vi.fn() }));

const { appVersion, detectNode } = await import('../lib/api.js');
const { default: Settings } = await import('./Settings.svelte');

beforeEach(() => {
  disk.clear();
  vi.mocked(detectNode).mockReset();
  vi.mocked(appVersion).mockReset();
  vi.mocked(appVersion).mockResolvedValue('0.1.0');
});

const renderLoaded = async () => {
  render(Settings);
  return screen.findByLabelText(/Figma Personal Access Token/);
};

describe('Settings screen', () => {
  test('first launch shows an empty token and Node path, images on, author off, a masked token field, and no page or run name fields', async () => {
    const token = await renderLoaded();
    expect(token.value).toBe('');
    expect(token.type).toBe('password');
    expect(screen.queryByLabelText(/Figma Page URL/)).toBeNull();
    expect(screen.queryByLabelText(/Run name/)).toBeNull();
    expect(screen.getByLabelText(/Node path/).value).toBe('');
    expect(screen.getByRole('switch', { name: 'Include frame images' }).checked).toBe(true);
    expect(screen.getByRole('switch', { name: 'Show comment author' }).checked).toBe(false);
  });

  test('save confirms and persists; clearing the token then saving removes it', async () => {
    const token = await renderLoaded();
    await userEvent.type(token, 'figd_secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Settings saved.');
    expect(disk.get('token')).toBe('figd_secret');

    await userEvent.click(screen.getByRole('button', { name: 'Clear token' }));
    expect(token.value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(disk.has('token')).toBe(false));
  });

  test('saving after changing a toggle keeps the remembered page URL', async () => {
    disk.set('pageUrl', 'https://www.figma.com/design/K/f?node-id=1-1');
    await renderLoaded();
    await userEvent.click(screen.getByRole('switch', { name: 'Show comment author' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(disk.get('user')).toBe(true));
    expect(disk.get('pageUrl')).toBe('https://www.figma.com/design/K/f?node-id=1-1');
  });

  test('Detect reports the Node found, or the error', async () => {
    await renderLoaded();
    vi.mocked(detectNode).mockResolvedValueOnce({ path: '/opt/homebrew/bin/node', version: '22.9.0' });
    await userEvent.click(screen.getByRole('button', { name: 'Detect' }));
    await screen.findByText('Found Node 22.9.0 at /opt/homebrew/bin/node');

    vi.mocked(detectNode).mockRejectedValueOnce('Node 22.9 or later is required.');
    await userEvent.click(screen.getByRole('button', { name: 'Detect' }));
    await screen.findByText('Node 22.9 or later is required.');
  });

  test('shows the running app version', async () => {
    await renderLoaded();
    expect(await screen.findByText('Version 0.1.0')).toBeTruthy();
  });

  test('shows no version line when the version cannot be read', async () => {
    vi.mocked(appVersion).mockReset();
    vi.mocked(appVersion).mockRejectedValue(new Error('no app runtime'));
    await renderLoaded();
    await vi.mocked(appVersion).mock.results[0].value.catch(() => {});
    expect(screen.queryByText(/^Version/)).toBeNull();
  });
});
