import { beforeEach, describe, expect, test, vi } from 'vitest';
import { disk, load as fakeLoad } from '../test/fake-store.js';

vi.mock('@tauri-apps/plugin-store', async () => {
  const store = await import('../test/fake-store.js');
  return { ...store, load: vi.fn(store.load) };
});
vi.mock('./api.js', () => ({
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

const api = await import('./api.js');
const { load: loadStore } = await import('@tauri-apps/plugin-store');
const {
  session,
  initSession,
  getComments,
  syncRun,
  startNewPage,
  backToComments,
  openRun,
  removeRun,
  removeAllRuns,
  toggleCritiqueLayout,
  unlockCritique,
  lockCritique,
  openReplyEditor,
  updateDraft,
  reviewPush,
  confirmPush,
} = await import('./session.svelte.js');

const PAGE_A = 'https://www.figma.com/design/A/file?node-id=1-1';
const PAGE_B = 'https://www.figma.com/design/B/file?node-id=2-2';
const runFor = (id, source) => ({ id, dir: `/runs/${id}`, markdown: '# Design critique', source });

beforeEach(() => {
  disk.clear();
  disk.set('token', 'figd_secret');
  vi.mocked(loadStore).mockReset().mockImplementation(fakeLoad);
  for (const fn of Object.values(api)) fn.mockReset();
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
    threadInfo: null,
    outbox: null,
    actionsError: null,
    actionsLoading: false,
    queueBusy: false,
    review: null,
    unlocked: false,
    replyDrafts: [],
    transitionBusy: false,
  });
});

describe('starting a run from the form', () => {
  test('the remembered page and critique layout are restored on launch', async () => {
    disk.set('pageUrl', PAGE_A);
    disk.set('critiqueLayout', 'grid');
    await initSession();
    expect(session.draft.pageUrl).toBe(PAGE_A);
    expect(session.draft.runName).toBe('');
    expect(session.critiqueLayout).toBe('grid');
    expect(session.critiqueLayoutReady).toBe(true);
  });

  test('passes the entered page and trimmed name with the saved settings, and remembers the page', async () => {
    session.draft = { pageUrl: ` ${PAGE_A} `, runName: ' checkout ' };
    api.startRun.mockResolvedValue('checkout-design-critique');
    api.readRun.mockResolvedValue(runFor('checkout-design-critique', { pageUrl: PAGE_A, runName: 'checkout' }));

    await getComments();

    expect(api.startRun.mock.calls[0][0]).toMatchObject({
      token: 'figd_secret',
      pageUrl: PAGE_A,
      runName: 'checkout',
      images: true,
    });
    expect(disk.get('pageUrl')).toBe(PAGE_A);
    expect(session.run.id).toBe('checkout-design-critique');
    expect(session.running).toBe(false);
  });

  test('a missing URL is a field error and starts nothing', async () => {
    await getComments();
    expect(session.urlError).toMatch(/page URL is missing/);
    expect(session.error).toBeNull();
    expect(api.startRun).not.toHaveBeenCalled();
  });

  test('a missing token points to Settings and starts nothing', async () => {
    disk.delete('token');
    session.draft.pageUrl = PAGE_A;
    await getComments();
    expect(session.error).toMatch(/token is missing/);
    expect(session.errorNeedsSettings).toBe(true);
    expect(session.urlError).toBeNull();
    expect(api.startRun).not.toHaveBeenCalled();
    expect(disk.has('pageUrl')).toBe(false);
  });

  test('both missing reports both', async () => {
    disk.delete('token');
    await getComments();
    expect(session.urlError).toBeTruthy();
    expect(session.error).toMatch(/token is missing/);
  });

  test('a successful run clears New page mode; a failed one leaves it and the draft', async () => {
    session.run = runFor('old-design-critique', { pageUrl: PAGE_B, runName: 'old' });
    startNewPage();
    session.draft = { pageUrl: PAGE_A, runName: 'new' };

    api.startRun.mockRejectedValueOnce('Figma returned 403');
    await getComments();
    expect(session.newPage).toBe(true);
    expect(session.draft).toEqual({ pageUrl: PAGE_A, runName: 'new' });
    expect(session.error).toBe('Figma returned 403');
    expect(session.run.id).toBe('old-design-critique');

    api.startRun.mockResolvedValueOnce('new-design-critique');
    api.readRun.mockResolvedValueOnce(runFor('new-design-critique', { pageUrl: PAGE_A, runName: 'new' }));
    await getComments();
    expect(session.newPage).toBe(false);
    expect(session.run.id).toBe('new-design-critique');
  });
});

describe('critique layout preference', () => {
  test('opening, syncing, and removing runs preserve the chosen layout', async () => {
    disk.set('critiqueLayout', 'grid');
    await initSession();
    const source = { pageUrl: PAGE_A, runName: 'home' };
    api.readRun.mockResolvedValueOnce(runFor('home-design-critique', source));
    await openRun('home-design-critique');
    startNewPage();
    backToComments();
    api.startRun.mockResolvedValue('home-design-critique-1');
    api.readRun.mockResolvedValueOnce(runFor('home-design-critique-1', source));

    await syncRun();
    await removeAllRuns();

    expect(session.critiqueLayout).toBe('grid');
    expect(disk.get('critiqueLayout')).toBe('grid');
  });

  test('a toggle cannot overwrite a preference that is still loading', async () => {
    disk.set('critiqueLayout', 'grid');
    let finish;
    vi.mocked(loadStore).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

    const loading = initSession();
    await toggleCritiqueLayout();
    expect(session.critiqueLayout).toBe('single');
    expect(disk.get('critiqueLayout')).toBe('grid');

    finish(await fakeLoad());
    await loading;
    expect(session.critiqueLayout).toBe('grid');
  });

  test('layout changes persist without overlapping saves', async () => {
    await initSession();
    let finish;
    const saving = new Promise((resolve) => (finish = resolve));
    vi.mocked(loadStore).mockImplementationOnce(async () => {
      const store = await fakeLoad();
      return {
        ...store,
        save: async () => {
          await saving;
          await store.save();
        },
      };
    });

    const first = toggleCritiqueLayout();
    await toggleCritiqueLayout();
    expect(session.critiqueLayout).toBe('grid');
    expect(session.critiqueLayoutSaving).toBe(true);
    finish();
    await first;
    expect(disk.get('critiqueLayout')).toBe('grid');

    await toggleCritiqueLayout();
    expect(disk.get('critiqueLayout')).toBe('single');
    expect(session.critiqueLayoutSaving).toBe(false);
  });

  test('a preference read failure is reported without removing the critique', async () => {
    session.run = runFor('home-design-critique', null);
    vi.mocked(loadStore).mockRejectedValue(new Error('Store unavailable'));

    await initSession();

    expect(session.error).toContain('Could not load layout preference');
    expect(session.error).toContain('Store unavailable');
    expect(session.critiqueLayout).toBe('single');
    expect(session.critiqueLayoutReady).toBe(true);
    expect(session.run.id).toBe('home-design-critique');
  });

  test('a failed save keeps the chosen layout, reports the error, and allows another toggle', async () => {
    await initSession();
    vi.mocked(loadStore).mockImplementationOnce(async () => ({
      ...(await fakeLoad()),
      save: async () => {
        throw new Error('Permission denied');
      },
    }));

    await toggleCritiqueLayout();

    expect(session.critiqueLayout).toBe('grid');
    expect(disk.has('critiqueLayout')).toBe(false);
    expect(session.error).toContain('Could not save layout preference');
    expect(session.error).toContain('Permission denied');
    expect(session.critiqueLayoutSaving).toBe(false);

    await toggleCritiqueLayout();
    expect(disk.get('critiqueLayout')).toBe('single');
    expect(session.error).toBeNull();
  });
});

describe('New page and Back to Comments', () => {
  test('New page clears the run name but keeps the URL; Back returns without fetching', () => {
    session.run = runFor('a-design-critique', null);
    session.draft = { pageUrl: PAGE_A, runName: 'typed' };
    startNewPage();
    expect(session.newPage).toBe(true);
    expect(session.draft).toEqual({ pageUrl: PAGE_A, runName: '' });
    backToComments();
    expect(session.newPage).toBe(false);
    expect(session.run.id).toBe('a-design-critique');
    expect(api.startRun).not.toHaveBeenCalled();
  });
});

describe('Sync comments', () => {
  test("fetches the displayed run's own page, not the last one entered, and leaves the remembered page alone", async () => {
    disk.set('pageUrl', PAGE_B);
    session.draft.pageUrl = PAGE_B;
    session.run = runFor('a-design-critique', { pageUrl: PAGE_A, runName: 'a' });
    api.startRun.mockResolvedValue('a-design-critique-1');
    api.readRun.mockResolvedValue(runFor('a-design-critique-1', { pageUrl: PAGE_A, runName: 'a' }));

    await syncRun();

    expect(api.startRun.mock.calls[0][0]).toMatchObject({ pageUrl: PAGE_A, runName: 'a' });
    expect(session.run.id).toBe('a-design-critique-1');
    expect(disk.get('pageUrl')).toBe(PAGE_B);
    expect(session.draft.pageUrl).toBe(PAGE_B);
  });

  test('a run without a source starts nothing and says to use New page', async () => {
    session.run = runFor('a-design-critique', null);
    await syncRun();
    expect(api.startRun).not.toHaveBeenCalled();
    expect(session.error).toMatch(/Use New page/);
  });
});

describe('opening a run', () => {
  test('shows it on Comments and leaves New page mode', async () => {
    session.screen = 'history';
    session.newPage = true;
    api.readRun.mockResolvedValue(runFor('a-design-critique', null));
    await openRun('a-design-critique');
    expect(session.screen).toBe('comments');
    expect(session.newPage).toBe(false);
    expect(session.run.id).toBe('a-design-critique');
  });
});

describe('removing runs', () => {
  test('removing the displayed run clears it so Comments shows the form; another run leaves it', async () => {
    session.run = runFor('a-design-critique', null);
    api.deleteRun.mockResolvedValue(undefined);
    expect(await removeRun('b-design-critique')).toBeNull();
    expect(session.run.id).toBe('a-design-critique');
    expect(await removeRun('a-design-critique')).toBeNull();
    expect(session.run).toBeNull();
    expect(api.deleteRun).toHaveBeenCalledWith('b-design-critique');
  });

  describe('run-scoped outbox', () => {
    const info = {
      destination: PAGE_A,
      fileKey: 'A',
      threads: [{ rootId: 'root', frame: 'Home', pin: '1', message: 'Feedback', user: 'ada', done: false }],
    };
    const pending = {
      version: 1,
      revision: 1,
      actions: [{ id: 'action-1', rootId: 'root', kind: 'reply', status: 'pending', text: 'Keep this draft' }],
    };

    test('sync creates a fresh run without copying actions; reopening History restores the earlier outbox', async () => {
      const oldId = 'home-design-critique';
      const newId = 'home-design-critique-1';
      const source = { pageUrl: PAGE_A, runName: 'home' };
      const boxes = { [oldId]: pending, [newId]: { version: 1, revision: 0, actions: [] } };
      api.readRun.mockImplementation(async (id) => runFor(id, source));
      api.readThreads.mockResolvedValue(info);
      api.readOutbox.mockImplementation(async (id) => structuredClone(boxes[id]));
      api.startRun.mockResolvedValue(newId);

      await openRun(oldId);
      expect(session.outbox.actions[0].text).toBe('Keep this draft');
      await syncRun();
      expect(session.run.id).toBe(newId);
      expect(session.outbox.actions).toEqual([]);
      expect(boxes[oldId]).toEqual(pending);
      expect(api.pushRun).not.toHaveBeenCalled();

      session.screen = 'history';
      await openRun(oldId);
      expect(session.run.id).toBe(oldId);
      expect(session.outbox.actions[0].text).toBe('Keep this draft');
    });

    test('an inline draft survives relock, sync, and reopening the original run', async () => {
      const oldId = 'home-design-critique';
      const newId = 'home-design-critique-1';
      const source = { pageUrl: PAGE_A, runName: 'home' };
      const boxes = {
        [oldId]: { version: 1, revision: 0, actions: [] },
        [newId]: { version: 1, revision: 0, actions: [] },
      };
      api.readRun.mockImplementation(async (id) => runFor(id, source));
      api.readThreads.mockResolvedValue(info);
      api.readOutbox.mockImplementation(async (id) => structuredClone(boxes[id]));
      api.queueReply.mockImplementation(async (id, revision, rootId, text) => {
        expect(revision).toBe(boxes[id].revision);
        boxes[id] = {
          version: 1,
          revision: revision + 1,
          actions: [{ id: 'action-1', rootId, kind: 'reply', status: 'pending', text }],
        };
        return structuredClone(boxes[id]);
      });
      api.startRun.mockResolvedValue(newId);

      await openRun(oldId);
      unlockCritique();
      openReplyEditor('root');
      updateDraft(session.replyDrafts[0].key, 'Saved on the earlier run');
      await lockCritique();
      expect(session.unlocked).toBe(false);
      expect(boxes[oldId].actions[0].text).toBe('Saved on the earlier run');
      await syncRun();
      expect(session.run.id).toBe(newId);
      expect(session.outbox.actions).toEqual([]);
      await openRun(oldId);
      expect(session.unlocked).toBe(false);
      expect(session.replyDrafts[0].text).toBe('Saved on the earlier run');
      expect(api.pushRun).not.toHaveBeenCalled();
    });

    test('a partial access failure keeps confirmed and unsent results on the original run', async () => {
      const id = 'home-design-critique';
      const initial = {
        version: 1,
        revision: 2,
        actions: [
          { id: 'action-1', rootId: 'root', kind: 'reply', status: 'pending', text: 'First' },
          { id: 'action-2', rootId: 'root', kind: 'reply', status: 'pending', text: 'Second' },
        ],
      };
      const partial = {
        version: 1,
        revision: 6,
        actions: [
          { ...initial.actions[0], status: 'confirmed' },
          { ...initial.actions[1], status: 'rejected', error: 'Figma returned 403.' },
        ],
      };
      api.readRun.mockResolvedValue(runFor(id, { pageUrl: PAGE_A, runName: 'home' }));
      api.readThreads.mockResolvedValue(info);
      api.readOutbox.mockResolvedValueOnce(initial).mockResolvedValueOnce(partial);
      api.pushRun.mockRejectedValue('Figma returned 403. Check the saved token and file access in Settings.');

      await openRun(id);
      session.unlocked = true;
      await reviewPush();
      await confirmPush();

      expect(api.pushRun).toHaveBeenCalledWith(id, 2, { token: 'figd_secret', nodePath: '' }, expect.any(Function));
      expect(session.error).toContain('403');
      expect(session.errorNeedsSettings).toBe(true);
      expect(session.outbox.actions.map((action) => action.status)).toEqual(['confirmed', 'rejected']);
      expect(session.run.id).toBe(id);
      expect(api.startRun).not.toHaveBeenCalled();
    });

    test('a read-only token can still sync after a refused push without moving the pending queue', async () => {
      const oldId = 'home-design-critique';
      const newId = 'home-design-critique-1';
      const source = { pageUrl: PAGE_A, runName: 'home' };
      const boxes = { [oldId]: pending, [newId]: { version: 1, revision: 0, actions: [] } };
      api.readRun.mockImplementation(async (id) => runFor(id, source));
      api.readThreads.mockResolvedValue(info);
      api.readOutbox.mockImplementation(async (id) => structuredClone(boxes[id]));
      api.pushRun.mockRejectedValue('Figma returned 403. Check the token scope and file access in Settings.');
      api.startRun.mockResolvedValue(newId);

      await openRun(oldId);
      session.unlocked = true;
      await reviewPush();
      await confirmPush();
      expect(session.outbox.actions[0].status).toBe('pending');
      expect(api.startRun).not.toHaveBeenCalled();
      await syncRun();

      expect(api.startRun.mock.calls[0][0].token).toBe('figd_secret');
      expect(session.run.id).toBe(newId);
      expect(session.outbox.actions).toEqual([]);
      expect(boxes[oldId]).toEqual(pending);
    });
  });

  test('a failed removal returns the error and keeps the displayed run', async () => {
    session.run = runFor('a-design-critique', null);
    api.deleteRun.mockRejectedValue('Could not remove run "a-design-critique": denied');
    expect(await removeRun('a-design-critique')).toMatch(/denied/);
    expect(session.run.id).toBe('a-design-critique');
  });

  test('remove all clears the run, the draft URL and the remembered page, but keeps other settings', async () => {
    disk.set('pageUrl', PAGE_A);
    session.draft.pageUrl = PAGE_A;
    session.run = runFor('a-design-critique', null);
    api.deleteAllRuns.mockResolvedValue(undefined);

    expect(await removeAllRuns()).toBeNull();

    expect(session.run).toBeNull();
    expect(session.draft.pageUrl).toBe('');
    expect(disk.has('pageUrl')).toBe(false);
    expect(disk.get('token')).toBe('figd_secret');
  });

  test('a partial failure keeps the remembered page, reports the error, and drops a displayed run that is gone', async () => {
    disk.set('pageUrl', PAGE_A);
    session.draft.pageUrl = PAGE_A;
    session.run = runFor('a-design-critique', null);
    api.deleteAllRuns.mockRejectedValue('Could not remove: stuck-design-critique');
    api.readRun.mockRejectedValue('Run "a-design-critique" was not found.');

    expect(await removeAllRuns()).toMatch(/stuck-design-critique/);

    expect(disk.get('pageUrl')).toBe(PAGE_A);
    expect(session.draft.pageUrl).toBe(PAGE_A);
    expect(session.run).toBeNull();
  });

  test('nothing is removed while a run is in progress', async () => {
    session.running = true;
    expect(await removeRun('a-design-critique')).toMatch(/in progress/);
    expect(await removeAllRuns()).toMatch(/in progress/);
    expect(api.deleteRun).not.toHaveBeenCalled();
    expect(api.deleteAllRuns).not.toHaveBeenCalled();
  });
});
