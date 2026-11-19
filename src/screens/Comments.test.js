import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { disk } from '../test/fake-store.js';

vi.mock('@tauri-apps/plugin-store', async () => import('../test/fake-store.js'));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('../lib/api.js', () => ({
  detectNode: vi.fn(),
  startRun: vi.fn(),
  listRuns: vi.fn(),
  readRun: vi.fn(),
  copyRun: vi.fn(),
  deleteRun: vi.fn(),
  deleteAllRuns: vi.fn(),
}));

const { open } = await import('@tauri-apps/plugin-dialog');
const { copyRun, deleteRun, readRun, startRun } = await import('../lib/api.js');
const { initSession, session, removeRun } = await import('../lib/session.svelte.js');
const { default: Comments } = await import('./Comments.svelte');

const PAGE_A = 'https://www.figma.com/design/A/f?node-id=1-1';
const PAGE_B = 'https://www.figma.com/design/B/f?node-id=2-2';
const makeRun = (id, pageUrl) => ({
  id,
  dir: `/data/runs/${id}`,
  markdown: `# Design critique\n\n- [ ] **1**: Comment in ${id} [Resolved]\n`,
  source: pageUrl ? { pageUrl, runName: 'home' } : null,
});
const RUN = makeRun('home-design-critique', PAGE_A);

function resetSession() {
  Object.assign(session, {
    screen: 'comments',
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
    critiqueLayout: 'single',
    critiqueLayoutReady: false,
    critiqueLayoutSaving: false,
  });
}

beforeEach(() => {
  disk.clear();
  disk.set('token', 'figd_secret');
  for (const fn of [startRun, readRun, copyRun, deleteRun, open]) vi.mocked(fn).mockReset();
  resetSession();
});

const button = (name) => screen.getByRole('button', { name });
const urlInput = () => screen.getByLabelText(/Figma Page URL/);
const nameInput = () => screen.getByLabelText(/Run name/);

describe('page input form', () => {
  test('first launch shows the form with Get comments and no Back control', () => {
    render(Comments);
    expect(urlInput().value).toBe('');
    expect(nameInput().value).toBe('');
    expect(button('Get comments')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to Comments' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync comments' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Two-column layout' })).toBeNull();
  });

  test('the URL is pre-filled from the last page used and the run name starts empty', () => {
    session.draft = { pageUrl: PAGE_A, runName: '' };
    render(Comments);
    expect(urlInput().value).toBe(PAGE_A);
    expect(nameInput().value).toBe('');
  });

  test('a missing URL shows a message next to the input and starts nothing', async () => {
    render(Comments);
    await userEvent.click(button('Get comments'));
    const message = await screen.findByText(/page URL is missing/);
    expect(urlInput().closest('label').contains(message)).toBe(true);
    expect(startRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
  });

  test('a missing token points to Settings and starts nothing', async () => {
    disk.delete('token');
    render(Comments);
    await userEvent.type(urlInput(), PAGE_A);
    await userEvent.click(button('Get comments'));
    expect((await screen.findByRole('alert')).textContent).toContain('token is missing');
    expect(startRun).not.toHaveBeenCalled();

    await userEvent.click(button('Open Settings'));
    expect(session.screen).toBe('settings');
  });

  test('starting a run passes the entered URL and name, streams output, hides the form, then shows the critique', async () => {
    let finish;
    vi.mocked(startRun).mockImplementation((_settings, onEvent) => {
      onEvent({ kind: 'step', step: 'fetch' });
      onEvent({ kind: 'log', line: 'Page: "Home" (1:1)' });
      return new Promise((resolve) => (finish = resolve));
    });
    vi.mocked(readRun).mockResolvedValue(RUN);

    render(Comments);
    await userEvent.type(urlInput(), PAGE_A);
    await userEvent.type(nameInput(), 'home');
    await userEvent.click(button('Get comments'));

    await screen.findByText(/Page: "Home"/);
    expect(screen.getByRole('status').textContent).toContain('Fetching comments from Figma');
    expect(screen.queryByRole('button', { name: 'Get comments' })).toBeNull();
    expect(screen.queryByLabelText(/Figma Page URL/)).toBeNull();
    expect(vi.mocked(startRun).mock.calls[0][0]).toMatchObject({
      token: 'figd_secret',
      pageUrl: PAGE_A,
      runName: 'home',
      images: true,
      user: false,
    });

    finish('home-design-critique');
    await screen.findByRole('heading', { name: 'Design critique' });
    expect(screen.getByText(/Comment in home-design-critique \[Resolved\]/)).toBeTruthy();
    expect(button('Sync comments')).toBeTruthy();
    expect(button('Download markdown')).toBeTruthy();
    expect(button('New page')).toBeTruthy();
    expect(screen.queryByText(/figd_secret/)).toBeNull();
  });

  test('a failed run shows the error, no critique, and keeps what was typed', async () => {
    vi.mocked(startRun).mockRejectedValue('Figma returned 403: the token is invalid.');
    render(Comments);
    await userEvent.type(urlInput(), PAGE_A);
    await userEvent.click(button('Get comments'));
    expect((await screen.findByRole('alert')).textContent).toContain('Figma returned 403');
    expect(session.run).toBeNull();
    expect(urlInput().value).toBe(PAGE_A);
    expect(button('Get comments').disabled).toBe(false);
  });

  test('a streamed failure replaces the live output with a single error message', async () => {
    const message = 'Figma returned 403: the token is invalid.';
    let emit;
    let fail;
    vi.mocked(startRun).mockImplementation((_settings, onEvent) => {
      emit = onEvent;
      onEvent({ kind: 'log', line: 'Reading Figma comments...' });
      return new Promise((_resolve, reject) => (fail = reject));
    });
    render(Comments);
    await userEvent.type(urlInput(), PAGE_A);
    await userEvent.click(button('Get comments'));

    expect((await screen.findByLabelText('Output')).textContent).toContain('Reading Figma comments...');
    expect(screen.queryByRole('alert')).toBeNull();
    emit({ kind: 'log', line: message });
    await waitFor(() => expect(screen.getByLabelText('Output').textContent).toContain(message));
    fail(message);

    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(screen.getAllByText(message, { exact: false })).toHaveLength(1);
    expect(screen.queryByLabelText('Output')).toBeNull();
  });
});

describe('critique layout', () => {
  test('the toggle persists both modes across reinitialization without changing the critique or fetching', async () => {
    session.run = RUN;
    const view = render(Comments);
    const toggle = button('Two-column layout');
    expect(toggle.disabled).toBe(true);
    await initSession();
    await waitFor(() => expect(toggle.disabled).toBe(false));
    const critique = screen.getByRole('heading', { name: 'Design critique' }).closest('.critique');
    const content = critique.innerHTML;

    await userEvent.click(toggle);

    await waitFor(() => expect(disk.get('critiqueLayout')).toBe('grid'));
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(critique.classList.contains('grid')).toBe(true);
    expect(critique.innerHTML).toBe(content);

    view.unmount();
    resetSession();
    session.run = RUN;
    await initSession();
    render(Comments);
    const restoredToggle = button('Two-column layout');
    expect(restoredToggle.getAttribute('aria-pressed')).toBe('true');
    const restoredCritique = screen.getByRole('heading', { name: 'Design critique' }).closest('.critique');
    expect(restoredCritique.classList.contains('grid')).toBe(true);
    expect(restoredCritique.innerHTML).toBe(content);

    restoredToggle.focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(disk.get('critiqueLayout')).toBe('single'));
    expect(restoredToggle.getAttribute('aria-pressed')).toBe('false');
    expect(restoredCritique.classList.contains('grid')).toBe(false);
    expect(restoredCritique.innerHTML).toBe(content);
    expect(startRun).not.toHaveBeenCalled();
    expect(readRun).not.toHaveBeenCalled();
  });
});

describe('toolbar and New page', () => {
  test("Sync comments fetches the displayed run's own page", async () => {
    session.run = RUN;
    session.draft.pageUrl = PAGE_B;
    vi.mocked(startRun).mockResolvedValue('home-design-critique-1');
    vi.mocked(readRun).mockResolvedValue(makeRun('home-design-critique-1', PAGE_A));
    render(Comments);

    await userEvent.click(button('Sync comments'));

    await screen.findByText(/Comment in home-design-critique-1/);
    expect(vi.mocked(startRun).mock.calls[0][0]).toMatchObject({ pageUrl: PAGE_A, runName: 'home' });
  });

  test('while a sync is in progress no run action is available, and the critique returns when it ends', async () => {
    session.run = RUN;
    let finish;
    vi.mocked(startRun).mockImplementation((_settings, onEvent) => {
      onEvent({ kind: 'step', step: 'generate' });
      return new Promise((resolve) => (finish = resolve));
    });
    vi.mocked(readRun).mockResolvedValue(makeRun('home-design-critique-1', PAGE_A));
    render(Comments);

    await userEvent.click(button('Sync comments'));

    expect((await screen.findByRole('status')).textContent).toContain('Generating the critique');
    for (const name of ['Get comments', 'Sync comments', 'New page', 'Download markdown', 'Back to Comments']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }

    finish('home-design-critique-1');
    await screen.findByText(/Comment in home-design-critique-1/);
    expect(button('Sync comments')).toBeTruthy();
    expect(button('New page')).toBeTruthy();
  });

  test('Sync on a run with no recorded page says to use New page', async () => {
    session.run = makeRun('old-design-critique', null);
    render(Comments);
    await userEvent.click(button('Sync comments'));
    expect((await screen.findByRole('alert')).textContent).toContain('Use New page');
    expect(startRun).not.toHaveBeenCalled();
  });

  test('New page shows the form with only Back to Comments; Back returns the same critique without fetching', async () => {
    session.run = RUN;
    session.draft = { pageUrl: PAGE_B, runName: 'typed' };
    render(Comments);

    await userEvent.click(button('New page'));
    expect(urlInput().value).toBe(PAGE_B);
    expect(nameInput().value).toBe('');
    expect(button('Back to Comments')).toBeTruthy();
    for (const name of ['New page', 'Sync comments', 'Download markdown']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByText(/Comment in home-design-critique/)).toBeNull();

    await userEvent.click(button('Back to Comments'));
    expect(screen.getByText(/Comment in home-design-critique/)).toBeTruthy();
    expect(button('Sync comments')).toBeTruthy();
    expect(startRun).not.toHaveBeenCalled();
  });

  test('a failed new-page run keeps the form and values, and Back still returns to the earlier critique', async () => {
    session.run = RUN;
    render(Comments);
    await userEvent.click(button('New page'));
    await userEvent.clear(urlInput());
    await userEvent.type(urlInput(), PAGE_B);
    await userEvent.type(nameInput(), 'other');
    vi.mocked(startRun).mockRejectedValue('Figma returned 404');

    await userEvent.click(button('Get comments'));

    expect((await screen.findByRole('alert')).textContent).toContain('404');
    expect(urlInput().value).toBe(PAGE_B);
    expect(nameInput().value).toBe('other');
    await userEvent.click(button('Back to Comments'));
    expect(screen.getByText(/Comment in home-design-critique/)).toBeTruthy();
  });

  test('a successful new-page run replaces the critique', async () => {
    session.run = RUN;
    render(Comments);
    await userEvent.click(button('New page'));
    await userEvent.clear(urlInput());
    await userEvent.type(urlInput(), PAGE_B);
    vi.mocked(startRun).mockResolvedValue('other-design-critique');
    vi.mocked(readRun).mockResolvedValue(makeRun('other-design-critique', PAGE_B));

    await userEvent.click(button('Get comments'));

    await screen.findByText(/Comment in other-design-critique/);
    expect(screen.queryByText(/Comment in home-design-critique\b/)).toBeNull();
  });

  test('removing the displayed run from History returns Comments to the form', async () => {
    session.run = RUN;
    vi.mocked(deleteRun).mockResolvedValue(undefined);
    render(Comments);
    expect(button('Sync comments')).toBeTruthy();

    await removeRun('home-design-critique');

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sync comments' })).toBeNull());
    expect(button('Get comments')).toBeTruthy();
  });
});

describe('download', () => {
  test('a download error does not bring back output from a previous run', async () => {
    session.run = RUN;
    session.log = ['Earlier run finished.'];
    vi.mocked(open).mockResolvedValue('/Users/me/Desktop');
    vi.mocked(copyRun).mockRejectedValue('Permission denied');
    render(Comments);

    await userEvent.click(button('Download markdown'));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not save the run: Permission denied');
    expect(screen.queryByLabelText('Output')).toBeNull();
    expect(screen.queryByText('Earlier run finished.')).toBeNull();
  });

  test('copies the run to the chosen folder; cancelling copies nothing and shows no error', async () => {
    session.run = RUN;
    render(Comments);

    vi.mocked(open).mockResolvedValueOnce(null);
    await userEvent.click(button('Download markdown'));
    expect(copyRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    vi.mocked(open).mockResolvedValueOnce('/Users/me/Desktop');
    vi.mocked(copyRun).mockResolvedValue('/Users/me/Desktop/home-design-critique');
    await userEvent.click(button('Download markdown'));
    await waitFor(() => expect(copyRun).toHaveBeenCalledWith('home-design-critique', '/Users/me/Desktop'));
    await screen.findByText('Saved to /Users/me/Desktop/home-design-critique');
  });
});
