import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import App from './App.svelte';

vi.mock('@tauri-apps/plugin-store', async () => import('./test/fake-store.js'));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('./lib/api.js', () => ({
  appVersion: vi.fn().mockResolvedValue('0.0.0'),
  detectNode: vi.fn(),
  startRun: vi.fn(),
  listRuns: vi.fn().mockResolvedValue([]),
  readRun: vi.fn(),
  copyRun: vi.fn(),
}));

const navItem = (name) => screen.getByRole('button', { name });

describe('navigation shell', () => {
  test('shows Comments on launch with its sidebar item active', () => {
    render(App);
    expect(screen.getByRole('button', { name: 'Get comments' })).toBeTruthy();
    expect(navItem('Comments').getAttribute('aria-current')).toBe('page');
    expect(navItem('History').getAttribute('aria-current')).toBeNull();
  });

  test('switching screens shows the screen and moves the active marker', async () => {
    render(App);
    await userEvent.click(navItem('History'));
    expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
    expect(navItem('History').getAttribute('aria-current')).toBe('page');
    expect(navItem('Comments').getAttribute('aria-current')).toBeNull();

    await userEvent.click(navItem('Settings'));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(navItem('Settings').getAttribute('aria-current')).toBe('page');
  });
});
