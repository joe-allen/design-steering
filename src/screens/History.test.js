import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { disk } from '../test/fake-store.js';

vi.mock('@tauri-apps/plugin-store', async () => import('../test/fake-store.js'));
vi.mock('../lib/api.js', () => ({
  detectNode: vi.fn(),
  startRun: vi.fn(),
  listRuns: vi.fn(),
  readRun: vi.fn(),
  readThreads: vi.fn(),
  readOutbox: vi.fn(),
  queueReply: vi.fn(),
  queueDone: vi.fn(),
  editReply: vi.fn(),
  discardAction: vi.fn(),
  retryUncertain: vi.fn(),
  pushRun: vi.fn(),
  copyRun: vi.fn(),
  deleteRun: vi.fn(),
  deleteAllRuns: vi.fn(),
}));

const { deleteAllRuns, deleteRun, listRuns, readRun } = await import('../lib/api.js');
const { session } = await import('../lib/session.svelte.js');
const { default: History } = await import('./History.svelte');

const at = (iso) => new Date(iso).getTime();
const RUNS = [
  { id: 'checkout-design-critique', name: 'checkout', modifiedMs: at('2026-11-10T12:00:00') },
  { id: 'home-design-critique', name: 'home', modifiedMs: at('2026-11-01T12:00:00') },
  { id: 'Home-design-critique-1', name: 'Home', modifiedMs: at('2026-10-01T12:00:00') },
];

// Plays the backend: listRuns returns what is left after deletions.
let onDisk;
beforeEach(() => {
  onDisk = [...RUNS];
  disk.clear();
  for (const fn of [listRuns, readRun, deleteRun, deleteAllRuns]) vi.mocked(fn).mockReset();
  vi.mocked(listRuns).mockImplementation(async () => [...onDisk]);
  vi.mocked(deleteRun).mockImplementation(async (id) => void (onDisk = onDisk.filter((run) => run.id !== id)));
  vi.mocked(deleteAllRuns).mockImplementation(async () => void (onDisk = []));
  Object.assign(session, {
    screen: 'history',
    run: null,
    newPage: false,
    draft: { pageUrl: '', runName: '' },
    running: false,
    step: null,
    log: [],
    error: null,
    errorNeedsSettings: false,
    urlError: null,
    notice: null,
    threadInfo: null,
    outbox: null,
    actionsError: null,
    actionsLoading: false,
    queueBusy: false,
    review: null,
  });
});

const entries = () => [...screen.getByRole('list').querySelectorAll('li .open')].map((button) => button.textContent);
const button = (name) => screen.getByRole('button', { name });

describe('History screen', () => {
  test('lists runs in the order given, each labelled with date and name', async () => {
    render(History);
    await screen.findByRole('list');
    expect(entries()).toEqual(['2026-11-10 checkout', '2026-11-01 home', '2026-10-01 Home']);
  });

  test('search filters on name and date, ignoring case, and reports no matches', async () => {
    onDisk = RUNS.slice(0, 2);
    render(History);
    const search = await screen.findByRole('searchbox', { name: 'Search' });

    await userEvent.type(search, 'CHECK');
    expect(entries()).toEqual(['2026-11-10 checkout']);

    await userEvent.clear(search);
    await userEvent.type(search, '2026-11-01');
    expect(entries()).toEqual(['2026-11-01 home']);

    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText(/No runs match/)).toBeTruthy();
  });

  test('shows a message when there are no runs yet', async () => {
    onDisk = [];
    render(History);
    expect((await screen.findByText(/No runs yet/)).textContent).toContain('Get comments');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove all' })).toBeNull();
  });

  test('selecting an entry opens that run on the Comments screen', async () => {
    vi.mocked(readRun).mockResolvedValue({
      id: 'home-design-critique',
      dir: '/d',
      markdown: '# Design critique',
      source: null,
    });
    render(History);
    await userEvent.click(await screen.findByRole('button', { name: '2026-11-01 home' }));
    await vi.waitFor(() => expect(session.screen).toBe('comments'));
    expect(readRun).toHaveBeenCalledWith('home-design-critique');
    expect(session.run.id).toBe('home-design-critique');
  });
});

describe('removing runs', () => {
  test('removing one run asks first, then deletes only that run', async () => {
    render(History);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove 2026-11-01 home' }));

    expect(screen.getByRole('alertdialog').textContent).toContain('2026-11-01 home');
    expect(deleteRun).not.toHaveBeenCalled();

    await userEvent.click(button('Remove'));
    await waitFor(() => expect(entries()).toEqual(['2026-11-10 checkout', '2026-10-01 Home']));
    expect(deleteRun).toHaveBeenCalledWith('home-design-critique');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('cancelling a confirmation deletes nothing', async () => {
    render(History);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove 2026-11-01 home' }));
    await userEvent.click(button('Cancel'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(deleteRun).not.toHaveBeenCalled();
    expect(entries()).toHaveLength(3);

    await userEvent.click(button('Remove all'));
    await userEvent.click(button('Cancel'));
    expect(deleteAllRuns).not.toHaveBeenCalled();
    expect(entries()).toHaveLength(3);
  });

  test('Remove all asks first, then deletes everything and shows the empty state', async () => {
    disk.set('pageUrl', 'https://figma.test/p');
    disk.set('token', 'figd_secret');
    render(History);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove all' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('all runs');
    expect(deleteAllRuns).not.toHaveBeenCalled();

    await userEvent.click(button('Remove'));

    await screen.findByText(/No runs yet/);
    expect(deleteAllRuns).toHaveBeenCalledTimes(1);
    expect(disk.has('pageUrl')).toBe(false);
    expect(disk.get('token')).toBe('figd_secret');
  });

  test('removing the displayed run clears it from Comments', async () => {
    session.run = { id: 'home-design-critique', dir: '/d', markdown: '# x', source: null };
    render(History);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove 2026-11-01 home' }));
    await userEvent.click(button('Remove'));
    await waitFor(() => expect(session.run).toBeNull());
  });

  test('a failed removal shows the error and keeps the run listed', async () => {
    vi.mocked(deleteRun).mockRejectedValue('Could not remove run "home-design-critique": denied');
    render(History);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove 2026-11-01 home' }));
    await userEvent.click(button('Remove'));

    expect((await screen.findByRole('alert')).textContent).toContain('home-design-critique');
    expect(entries()).toContain('2026-11-01 home');
  });

  test('a partial Remove all failure names the run left, keeps it listed and keeps the remembered page', async () => {
    disk.set('pageUrl', 'https://figma.test/p');
    vi.mocked(deleteAllRuns).mockImplementation(async () => {
      onDisk = onDisk.filter((run) => run.id === 'home-design-critique');
      throw 'Could not remove: home-design-critique';
    });
    render(History);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove all' }));
    await userEvent.click(button('Remove'));

    expect((await screen.findByRole('alert')).textContent).toContain('home-design-critique');
    await waitFor(() => expect(entries()).toEqual(['2026-11-01 home']));
    expect(disk.get('pageUrl')).toBe('https://figma.test/p');
  });

  test('removal is disabled while a run is in progress', async () => {
    session.running = true;
    render(History);
    await screen.findByRole('list');
    expect(button('Remove all').disabled).toBe(true);
    expect(button('Remove 2026-11-01 home').disabled).toBe(true);
  });
});
