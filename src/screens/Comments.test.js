import { render, screen, waitFor, within } from '@testing-library/svelte';
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

const { open } = await import('@tauri-apps/plugin-dialog');
const { openUrl } = await import('@tauri-apps/plugin-opener');
const {
  copyRun,
  deleteRun,
  readRun,
  startRun,
  readThreads,
  readOutbox,
  queueReply,
  queueDone,
  editReply,
  discardAction,
  retryUncertain,
  pushRun,
} = await import('../lib/api.js');
const { initSession, openRun, session, removeRun } = await import('../lib/session.svelte.js');
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
}

beforeEach(() => {
  disk.clear();
  disk.set('token', 'figd_secret');
  for (const fn of [
    startRun,
    readRun,
    readThreads,
    readOutbox,
    queueReply,
    queueDone,
    editReply,
    discardAction,
    retryUncertain,
    pushRun,
    copyRun,
    deleteRun,
    open,
    openUrl,
  ])
    vi.mocked(fn).mockReset();
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

  const threadInfo = {
    destination: PAGE_A,
    fileKey: 'A',
    threads: [
      {
        rootId: 'root-1',
        frame: '1. Home',
        pin: '1',
        message: 'First thread',
        user: 'ada',
        done: false,
        resolved: false,
        link: 'https://www.figma.com/file/A?node-id=1-1#root-1',
        replies: [{ id: 'reply-1', message: 'A posted reply', user: 'grace', resolved: true }],
      },
      {
        rootId: 'root-2',
        frame: '1. Home',
        pin: '2',
        message: 'Second thread',
        user: 'grace',
        done: true,
        resolved: false,
        link: 'https://www.figma.com/file/A?node-id=1-1#root-2',
        replies: [],
      },
    ],
  };

  async function actionsForRun(actions = [], { run = RUN, info = threadInfo } = {}) {
    let saved = { version: 1, revision: actions.length, actions: structuredClone(actions) };
    const copy = () => structuredClone(saved);
    const change = (id, revision, update) => {
      expect(id).toBe(RUN.id);
      expect(revision).toBe(saved.revision);
      const next = copy();
      update(next);
      next.revision++;
      saved = next;
      return copy();
    };
    vi.mocked(readRun).mockResolvedValue(run);
    vi.mocked(readThreads).mockResolvedValue(structuredClone(info));
    vi.mocked(readOutbox).mockImplementation(async () => copy());
    vi.mocked(queueReply).mockImplementation(async (id, revision, rootId, text) =>
      change(id, revision, (box) =>
        box.actions.push({
          id: `action-${revision + 1}`,
          rootId,
          kind: 'reply',
          status: 'pending',
          text,
        }),
      ),
    );
    vi.mocked(queueDone).mockImplementation(async (id, revision, rootId) =>
      change(id, revision, (box) =>
        box.actions.push({
          id: `action-${revision + 1}`,
          rootId,
          kind: 'done',
          status: 'pending',
        }),
      ),
    );
    vi.mocked(editReply).mockImplementation(async (id, revision, actionId, text) =>
      change(id, revision, (box) => {
        const action = box.actions.find((item) => item.id === actionId);
        action.text = text;
        action.status = 'pending';
        delete action.error;
      }),
    );
    vi.mocked(discardAction).mockImplementation(async (id, revision, actionId) =>
      change(id, revision, (box) => {
        box.actions = box.actions.filter((action) => action.id !== actionId);
      }),
    );
    vi.mocked(retryUncertain).mockImplementation(async (id, revision, actionId, verified) =>
      change(id, revision, (box) => {
        expect(verified).toBe(true);
        const action = box.actions.find((item) => item.id === actionId);
        action.status = 'pending';
        delete action.error;
      }),
    );
    await openRun(RUN.id);
    return {
      get: copy,
      set: (value) => {
        saved = structuredClone(value);
      },
    };
  }

  describe('thread actions and push review', () => {
    test('opens locked and preserves frame, author, reply, and resolved presentation in both layouts', async () => {
      const markdown = [
        '# Design critique',
        '![Frame 1](./_frames/1-home.png)',
        '- [ ] **[1](https://www.figma.com/file/A?node-id=1-1#root-1)**: First thread (ada)',
        '  - A posted reply (grace) [Resolved]',
        '- [x] **[2](https://www.figma.com/file/A?node-id=1-1#root-2)**: Second thread (grace)',
      ]
        .join('\n\n')
        .replace('\n\n  -', '\n  -')
        .replace('\n\n- [x]', '\n- [x]');
      await actionsForRun([], { run: { ...RUN, markdown } });
      session.critiqueLayoutReady = true;
      render(Comments);

      expect(button('Lock critique').getAttribute('aria-pressed')).toBe('true');
      expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Mark pin 1 done' }).disabled).toBe(true);
      expect(screen.getByAltText('Frame 1').closest('.frame')).toBeTruthy();
      expect(screen.getByText('First thread').parentElement.textContent).toContain('(ada)');
      expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe(threadInfo.threads[0].link);
      expect(screen.getByText('A posted reply').parentElement.textContent).toContain('(grace) [Resolved]');

      await userEvent.click(button('Unlock critique'));
      expect(screen.getAllByRole('button', { name: 'Reply' })).toHaveLength(2);
      await userEvent.click(button('Two-column layout'));
      expect(screen.getByAltText('Frame 1').closest('.critique').classList.contains('grid')).toBe(true);
      expect(screen.getByText('A posted reply').closest('.frame')).toBeTruthy();
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('preserves surrounding and block Markdown alongside validated inline threads in both layouts', async () => {
      const info = structuredClone(threadInfo);
      info.threads[0].message =
        'First paragraph\n\nSecond paragraph\n\n## Thread heading\n\n- Bullet\n- [ ] Inner task\n\n```js\nconst safe = true;\n```';
      info.threads[0].replies[0].message = 'Reply introduction\n\nReply paragraph';
      const markdown = [
        '# Design critique',
        '',
        'Project introduction.',
        '',
        '## Background',
        '',
        'Background paragraph.',
        '',
        '![Frame 1](./_frames/1-home.png)',
        '',
        '- [ ] **[1](https://www.figma.com/file/A?node-id=1-1#root-1)**: First paragraph',
        '',
        '  Second paragraph',
        '',
        '  ## Thread heading',
        '',
        '  - Bullet',
        '  - [ ] Inner task',
        '',
        '  ```js',
        '  const safe = true;',
        '  ```',
        '  - Reply introduction',
        '',
        '    Reply paragraph [Resolved]',
        '- [x] **[2](https://www.figma.com/file/A?node-id=1-1#root-2)**: Second thread',
        '',
        '## Notes',
        '',
        'Closing paragraph.',
        '',
        '- [ ] Follow up elsewhere',
      ].join('\n');
      await actionsForRun([], { run: { ...RUN, markdown }, info });
      session.critiqueLayoutReady = true;
      render(Comments);

      expect(screen.getByText('Project introduction.')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Background' })).toBeTruthy();
      expect(screen.getByText('Background paragraph.')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy();
      expect(screen.getByText('Closing paragraph.')).toBeTruthy();
      const untrustedItem = screen.getByText('Follow up elsewhere').closest('li');
      expect(untrustedItem.querySelector('input').disabled).toBe(true);

      const row = screen.getByText('First paragraph').closest('li.thread');
      expect(within(row).getByText('Second paragraph')).toBeTruthy();
      expect(within(row).getByRole('heading', { name: 'Thread heading' })).toBeTruthy();
      expect(within(row).getByText('Bullet')).toBeTruthy();
      expect(within(row).getByText('Inner task').closest('li').querySelector('input').disabled).toBe(true);
      expect(row.querySelector('pre code').textContent).toContain('const safe = true;');
      expect(within(row).getByText('Reply paragraph').closest('li').textContent).toContain('[Resolved]');
      expect(screen.getAllByText('First paragraph')).toHaveLength(1);

      await userEvent.click(button('Unlock critique'));
      await userEvent.click(button('Two-column layout'));
      expect(screen.getByAltText('Frame 1').closest('.frame').contains(row)).toBe(true);
      await userEvent.click(within(row).getByRole('button', { name: 'Reply' }));
      await userEvent.type(within(row).getByLabelText('Reply to pin 1'), 'A local reply');
      await waitFor(() => expect(queueReply).toHaveBeenCalledWith(RUN.id, 0, 'root-1', 'A local reply'));
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('keeps Markdown intact when a generated-looking thread is inside a code block', async () => {
      const info = structuredClone(threadInfo);
      info.threads = [info.threads[0]];
      info.threads[0].replies = [];
      const example = '- [ ] **[1](https://www.figma.com/file/A?node-id=1-1#root-1)**: First thread';
      const markdown = `# Design critique\n\n\`\`\`markdown\n${example}\n\`\`\`\n\nOther notes.`;
      await actionsForRun([], { run: { ...RUN, markdown }, info });
      render(Comments);

      expect(document.querySelector('pre code').textContent.trim()).toBe(example);
      expect(screen.getByText('Other notes.')).toBeTruthy();
      expect(screen.getByText(/Some snapshot threads do not match/)).toBeTruthy();
      expect(document.querySelector('.critique').textContent).not.toContain('DesignSteeringThreadSlot');
      const row = screen.getByText('First thread').closest('li.thread');
      await userEvent.click(button('Unlock critique'));
      await userEvent.click(within(row).getByRole('checkbox', { name: 'Mark pin 1 done' }));
      await waitFor(() => expect(queueDone).toHaveBeenCalledWith(RUN.id, 0, 'root-1'));
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('does not place a validated thread beneath a different frame image', async () => {
      const info = structuredClone(threadInfo);
      info.threads = [info.threads[0]];
      info.threads[0].replies = [];
      const markdown = [
        '# Design critique',
        '',
        '![Frame 1](./_frames/2-other.png)',
        '',
        '- [ ] **[1](https://www.figma.com/file/A?node-id=1-1#root-1)**: First thread',
      ].join('\n');
      await actionsForRun([], { run: { ...RUN, markdown }, info });
      render(Comments);

      const wrongFrame = screen.getByAltText('Frame 1').closest('.frame');
      expect(wrongFrame.querySelector('input').disabled).toBe(true);
      expect(screen.getByText(/Some snapshot threads do not match/)).toBeTruthy();
      const row = [...document.querySelectorAll('li.thread')][0];
      expect(wrongFrame.contains(row)).toBe(false);
      await userEvent.click(button('Unlock critique'));
      expect(within(wrongFrame).queryByRole('button', { name: 'Reply' })).toBeNull();
      await userEvent.click(within(row).getByRole('checkbox', { name: 'Mark pin 1 done' }));
      await waitFor(() => expect(queueDone).toHaveBeenCalledWith(RUN.id, 0, 'root-1'));
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('does not associate indistinguishable Markdown rows with either root', async () => {
      const info = structuredClone(threadInfo);
      for (const thread of info.threads) {
        Object.assign(thread, { pin: '1', message: 'Same feedback', done: false, link: '', replies: [] });
      }
      const markdown = '# Design critique\n\n- [ ] **1**: Same feedback\n- [ ] **1**: Same feedback';
      await actionsForRun([], { run: { ...RUN, markdown }, info });
      render(Comments);

      expect(screen.getByText(/Some snapshot threads do not match/)).toBeTruthy();
      const critique = document.querySelector('.critique');
      expect([...critique.querySelectorAll('li:not(.thread) input')].every((input) => input.disabled)).toBe(true);
      const rows = critique.querySelectorAll('li.thread');
      expect(rows).toHaveLength(2);
      await userEvent.click(button('Unlock critique'));
      await userEvent.click(within(rows[1]).getByRole('checkbox', { name: 'Mark pin 1 done' }));
      await waitFor(() => expect(queueDone).toHaveBeenCalledWith(RUN.id, 0, 'root-2'));
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('edits and discards an inline draft and counts actions rather than threads or keystrokes', async () => {
      const backend = await actionsForRun();
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      const row = screen.getByText('First thread').closest('li');
      await userEvent.click(within(row).getByRole('button', { name: 'Reply' }));
      const draft = within(row).getByLabelText('Reply to pin 1');
      await userEvent.type(draft, 'First draft');
      expect(button('Save 1 update')).toBeTruthy();
      await waitFor(() => expect(backend.get().actions[0]?.text).toBe('First draft'));
      expect(queueReply).toHaveBeenCalledWith(RUN.id, 0, 'root-1', 'First draft');

      const mark = within(row).getByRole('checkbox', { name: 'Mark pin 1 done' });
      await userEvent.click(mark);
      await waitFor(() => expect(button('Save 2 updates')).toBeTruthy());
      await userEvent.clear(draft);
      await userEvent.type(draft, 'Updated draft');
      expect(button('Save 2 updates')).toBeTruthy();
      await userEvent.click(button('Save 2 updates'));
      const review = await screen.findByRole('dialog', { name: 'Review changes' });
      expect(review.textContent).toContain('Updated draft');
      expect(editReply).toHaveBeenCalledWith(RUN.id, 2, 'action-1', 'Updated draft');
      await userEvent.click(within(review).getByRole('button', { name: 'Cancel' }));

      await userEvent.click(mark);
      await waitFor(() => expect(button('Save 1 update')).toBeTruthy());
      await userEvent.click(within(row).getByRole('button', { name: 'Discard reply' }));
      await waitFor(() => expect(button('Sync comments')).toBeTruthy());
      expect(backend.get().actions).toEqual([]);
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('queues one done mark per thread and cannot remove a fetched mark', async () => {
      await actionsForRun();
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      const mark = screen.getByRole('checkbox', { name: 'Mark pin 1 done' });
      await userEvent.click(mark);
      await waitFor(() => expect(mark.checked).toBe(true));
      expect(queueDone).toHaveBeenCalledTimes(1);
      expect(queueDone).toHaveBeenCalledWith(RUN.id, 0, 'root-1');
      await userEvent.click(mark);
      await waitFor(() => expect(mark.checked).toBe(false));
      expect(discardAction).toHaveBeenCalledWith(RUN.id, 1, 'action-1');
      expect(pushRun).not.toHaveBeenCalled();

      const alreadyDone = screen.getByRole('checkbox', { name: 'Mark pin 2 done' });
      expect(alreadyDone.checked).toBe(true);
      expect(alreadyDone.disabled).toBe(true);
    });

    test('duplicate pins and forged Markdown cannot choose a different root in either layout', async () => {
      const info = structuredClone(threadInfo);
      info.threads[0].message =
        'First thread <input type="checkbox"> [forged](https://www.figma.com/file/OTHER#root-2)';
      info.threads[1].pin = '1';
      info.threads[1].done = false;
      const markdown = '# Design critique\n\n- [ ] **[1](https://www.figma.com/file/OTHER#root-2)**: Fake thread';
      await actionsForRun([], { run: { ...RUN, markdown }, info });
      session.critiqueLayoutReady = true;
      vi.mocked(openUrl).mockResolvedValue(undefined);
      render(Comments);

      const forged = screen.getByText(/Fake thread/).closest('li');
      expect(forged.querySelector('input').disabled).toBe(true);
      const first = screen.getByText(/First thread/).closest('li');
      const second = screen.getByText('Second thread').closest('li');
      expect(first.textContent).not.toContain('(ada)');
      expect(first.querySelector('input:not([aria-label])').disabled).toBe(true);
      await userEvent.click(within(first).getByRole('link', { name: 'forged' }));
      expect(queueDone).not.toHaveBeenCalled();
      expect(queueReply).not.toHaveBeenCalled();

      await userEvent.click(button('Unlock critique'));
      expect(within(forged).queryByRole('button', { name: 'Reply' })).toBeNull();
      await userEvent.click(within(second).getByRole('checkbox', { name: 'Mark pin 1 done' }));
      await waitFor(() => expect(queueDone).toHaveBeenCalledWith(RUN.id, 0, 'root-2'));
      await waitFor(() => expect(session.queueBusy).toBe(false));
      await userEvent.click(button('Two-column layout'));
      await userEvent.click(within(second).getByRole('checkbox', { name: 'Mark pin 1 done' }));
      await waitFor(() => expect(session.queueBusy).toBe(false));
      await userEvent.click(within(first).getByRole('checkbox', { name: 'Mark pin 1 done' }));
      await waitFor(() => expect(queueDone).toHaveBeenLastCalledWith(RUN.id, 2, 'root-1'));
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('locking and changing layout preserve drafts without sending them', async () => {
      const backend = await actionsForRun();
      session.critiqueLayoutReady = true;
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      await userEvent.click(
        within(screen.getByText('First thread').closest('li')).getByRole('button', { name: 'Reply' }),
      );
      await userEvent.type(screen.getByLabelText('Reply to pin 1'), 'Keep the last keystroke');
      await userEvent.click(button('Two-column layout'));
      expect(screen.getByLabelText('Reply to pin 1').value).toBe('Keep the last keystroke');
      await userEvent.click(button('Lock critique'));
      await waitFor(() => expect(button('Lock critique').getAttribute('aria-pressed')).toBe('true'));
      expect(backend.get().actions[0].text).toBe('Keep the last keystroke');
      expect(button('Sync comments')).toBeTruthy();
      expect(screen.getByText('Keep the last keystroke')).toBeTruthy();
      await userEvent.click(button('Unlock critique'));
      expect(screen.getByLabelText('Reply to pin 1').value).toBe('Keep the last keystroke');
      expect(button('Save 1 update')).toBeTruthy();
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('a failed local save keeps the text visible and prevents locking until it is saved', async () => {
      const backend = await actionsForRun();
      vi.mocked(queueReply).mockRejectedValueOnce('Disk is full');
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      await userEvent.click(
        within(screen.getByText('First thread').closest('li')).getByRole('button', { name: 'Reply' }),
      );
      await userEvent.type(screen.getByLabelText('Reply to pin 1'), 'Do not lose this');
      await userEvent.click(button('Lock critique'));
      expect((await screen.findByRole('alert')).textContent).toContain('Disk is full');
      expect(button('Unlock critique').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByLabelText('Reply to pin 1').value).toBe('Do not lose this');
      expect(backend.get().actions).toEqual([]);
      await userEvent.click(button('Retry saving draft'));
      await waitFor(() => expect(backend.get().actions[0]?.text).toBe('Do not lose this'));
      await userEvent.click(button('Lock critique'));
      await waitFor(() => expect(button('Lock critique').getAttribute('aria-pressed')).toBe('true'));
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('a lost local-save response cannot silently create a duplicate reply', async () => {
      const backend = await actionsForRun();
      const save = vi.mocked(queueReply).getMockImplementation();
      vi.mocked(queueReply).mockImplementationOnce(async (...args) => {
        await save(...args);
        throw new Error('Local response was lost');
      });
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      const row = screen.getByText('First thread').closest('li');
      await userEvent.click(within(row).getByRole('button', { name: 'Reply' }));
      await userEvent.type(within(row).getByLabelText('Reply to pin 1'), 'Possibly saved');
      await userEvent.click(button('Lock critique'));
      expect((await screen.findByRole('alert')).textContent).toContain('Local response was lost');
      expect(backend.get().actions).toHaveLength(1);
      await userEvent.click(button('Retry saving draft'));
      expect((await screen.findByRole('alert')).textContent).toContain('may already have been saved');
      expect(queueReply).toHaveBeenCalledTimes(1);
      expect(backend.get().actions).toHaveLength(1);

      const unsaved = within(row)
        .getByText(/may already have been saved/)
        .closest('.draft');
      await userEvent.click(within(unsaved).getByRole('button', { name: 'Discard reply' }));
      expect(button('Save 1 update')).toBeTruthy();
      expect(backend.get().actions).toHaveLength(1);
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('a lost edit response is reconciled when the saved action already has the new text', async () => {
      const backend = await actionsForRun([
        { id: 'action-1', rootId: 'root-1', kind: 'reply', status: 'pending', text: 'Original' },
      ]);
      const save = vi.mocked(editReply).getMockImplementation();
      vi.mocked(editReply).mockImplementationOnce(async (...args) => {
        await save(...args);
        throw new Error('Local response was lost');
      });
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      const draft = screen.getByLabelText('Reply to pin 1');
      await userEvent.clear(draft);
      await userEvent.type(draft, 'Updated');
      await userEvent.click(button('Lock critique'));
      await waitFor(() => expect(button('Lock critique').getAttribute('aria-pressed')).toBe('true'));
      expect(backend.get().actions[0].text).toBe('Updated');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('a draft saved behind a pending done-mark retains both actions', async () => {
      const backend = await actionsForRun();
      const saveMark = vi.mocked(queueDone).getMockImplementation();
      let release;
      vi.mocked(queueDone).mockImplementationOnce(async (...args) => {
        await new Promise((resolve) => (release = resolve));
        return saveMark(...args);
      });
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      const row = screen.getByText('First thread').closest('li');
      await userEvent.click(within(row).getByRole('button', { name: 'Reply' }));
      await userEvent.click(within(row).getByRole('checkbox', { name: 'Mark pin 1 done' }));
      await waitFor(() => expect(release).toBeTypeOf('function'));
      await userEvent.type(within(row).getByLabelText('Reply to pin 1'), 'Alongside the mark');
      await userEvent.click(button('Save 1 update'));
      release();
      const review = await screen.findByRole('dialog', { name: 'Review changes' });
      expect(review.textContent).toContain('Alongside the mark');
      expect(review.textContent).toContain('Done mark');
      expect(backend.get().actions.map((action) => action.kind)).toEqual(['done', 'reply']);
      expect(screen.queryByRole('alert')).toBeNull();
      await userEvent.click(within(review).getByRole('button', { name: 'Cancel' }));
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('review waits for an in-flight local save and includes the final keystroke', async () => {
      await actionsForRun();
      const save = vi.mocked(queueReply).getMockImplementation();
      let release;
      vi.mocked(queueReply).mockImplementationOnce(async (...args) => {
        await new Promise((resolve) => (release = resolve));
        return save(...args);
      });
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      await userEvent.click(
        within(screen.getByText('First thread').closest('li')).getByRole('button', { name: 'Reply' }),
      );
      const draft = screen.getByLabelText('Reply to pin 1');
      await userEvent.type(draft, 'A');
      await waitFor(() => expect(release).toBeTypeOf('function'));
      await userEvent.type(draft, 'BC');
      await userEvent.click(button('Save 1 update'));
      expect(pushRun).not.toHaveBeenCalled();
      release();
      const review = await screen.findByRole('dialog', { name: 'Review changes' });
      expect(review.textContent).toContain('ABC');
      expect(editReply).toHaveBeenCalledWith(RUN.id, 1, 'action-1', 'ABC');
      await userEvent.click(within(review).getByRole('button', { name: 'Cancel' }));
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('reviews the exact destination and batch, cancels, then confirms without refreshing', async () => {
      const backend = await actionsForRun([
        { id: 'action-1', rootId: 'root-1', kind: 'reply', status: 'pending', text: 'Exact reply\nSecond line' },
        { id: 'action-2', rootId: 'root-1', kind: 'done', status: 'pending' },
      ]);
      let finish;
      vi.mocked(pushRun).mockImplementation((_id, _revision, _settings, onEvent) => {
        onEvent({ kind: 'step', step: 'push' });
        return new Promise((resolve) => (finish = resolve));
      });
      render(Comments);
      expect(button('Sync comments')).toBeTruthy();
      await userEvent.click(button('Unlock critique'));
      await userEvent.click(button('Save 2 updates'));
      let review = await screen.findByRole('dialog', { name: 'Review changes' });
      expect(review.textContent).toContain(PAGE_A);
      expect(review.textContent).toContain('Exact reply\nSecond line');
      expect(review.textContent).toContain('root-1');
      expect(review.textContent).toContain('token saved in Settings');
      await userEvent.click(within(review).getByRole('button', { name: 'Cancel' }));
      expect(pushRun).not.toHaveBeenCalled();
      expect(button('Save 2 updates')).toBeTruthy();

      await userEvent.click(button('Save 2 updates'));
      review = await screen.findByRole('dialog', { name: 'Review changes' });
      await userEvent.click(within(review).getByRole('button', { name: 'Send to Figma' }));
      expect((await screen.findByRole('status')).textContent).toContain('Pushing changes');
      expect(screen.queryByRole('button', { name: 'Sync comments' })).toBeNull();
      expect(pushRun).toHaveBeenCalledWith(RUN.id, 2, { token: 'figd_secret', nodePath: '' }, expect.any(Function));
      backend.set({
        version: 1,
        revision: 6,
        actions: [
          { id: 'action-1', rootId: 'root-1', kind: 'reply', status: 'confirmed', text: 'Exact reply\nSecond line' },
          { id: 'action-2', rootId: 'root-1', kind: 'done', status: 'rejected', error: 'Figma returned 400.' },
        ],
      });
      finish();
      await screen.findByText(/Done mark · Rejected/);
      expect(screen.getByText(/Reply · Sent/)).toBeTruthy();
      expect(button('Save 1 update')).toBeTruthy();
      await userEvent.click(button('Save 1 update'));
      const retryReview = await screen.findByRole('dialog', { name: 'Review changes' });
      expect(retryReview.textContent).toContain('Done mark');
      expect(retryReview.textContent).not.toContain('Exact reply');
      await userEvent.click(within(retryReview).getByRole('button', { name: 'Cancel' }));
      expect(startRun).not.toHaveBeenCalled();
      expect(session.run.id).toBe(RUN.id);
    });

    test('relocking exposes pull-only Sync without moving or sending the earlier queue', async () => {
      const backend = await actionsForRun([
        { id: 'action-1', rootId: 'root-1', kind: 'reply', status: 'pending', text: 'Keep on this run' },
      ]);
      const newId = 'home-design-critique-1';
      vi.mocked(startRun).mockResolvedValue(newId);
      vi.mocked(readRun).mockImplementation(async (id) => (id === newId ? makeRun(newId, PAGE_A) : RUN));
      vi.mocked(readOutbox).mockImplementation(async (id) =>
        id === RUN.id ? backend.get() : { version: 1, revision: 0, actions: [] },
      );
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      expect(button('Save 1 update')).toBeTruthy();
      await userEvent.click(button('Lock critique'));
      await waitFor(() => expect(button('Sync comments')).toBeTruthy());
      await userEvent.click(button('Sync comments'));
      await waitFor(() => expect(session.run.id).toBe(newId));
      expect(session.outbox.actions).toEqual([]);
      expect(backend.get().actions[0].text).toBe('Keep on this run');
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('a changed review does not dispatch', async () => {
      const backend = await actionsForRun([
        { id: 'action-1', rootId: 'root-1', kind: 'reply', status: 'pending', text: 'Reviewed reply' },
      ]);
      render(Comments);
      await userEvent.click(button('Unlock critique'));
      await userEvent.click(button('Save 1 update'));
      const review = await screen.findByRole('dialog', { name: 'Review changes' });
      const changed = backend.get();
      changed.revision++;
      changed.actions[0].text = 'Changed reply';
      backend.set(changed);
      session.outbox = changed;
      await userEvent.click(within(review).getByRole('button', { name: 'Send to Figma' }));
      expect((await screen.findByRole('alert')).textContent).toContain('changed after review');
      expect(pushRun).not.toHaveBeenCalled();
    });

    test('uncertain actions require an explicit acknowledgement before retry', async () => {
      await actionsForRun([
        { id: 'action-1', rootId: 'root-1', kind: 'reply', status: 'uncertain', text: 'Maybe sent' },
        { id: 'action-2', rootId: 'root-1', kind: 'reply', status: 'confirmed', text: 'Sent already' },
        { id: 'action-3', rootId: 'root-1', kind: 'done', status: 'rejected', error: 'Figma returned 403.' },
      ]);
      vi.mocked(openUrl).mockResolvedValue(undefined);
      render(Comments);
      expect(screen.getByText(/Needs verification in Figma/)).toBeTruthy();
      await userEvent.click(button('Unlock critique'));
      expect(button('Save 1 update')).toBeTruthy();
      await userEvent.click(button('Open in Figma'));
      expect(openUrl).toHaveBeenCalledWith(threadInfo.threads[0].link);
      await userEvent.click(button('Retry after checking'));
      expect(screen.getByText(/can create a duplicate/)).toBeTruthy();
      await userEvent.click(button('Cancel retry'));
      expect(retryUncertain).not.toHaveBeenCalled();
      await userEvent.click(button('Retry after checking'));
      await userEvent.click(button('I checked Figma; retry'));
      await screen.findByRole('button', { name: 'Save 2 updates' });
      expect(retryUncertain).toHaveBeenCalledWith(RUN.id, 3, 'action-1', true);
      expect(screen.getByLabelText('Reply to pin 1').value).toBe('Maybe sent');
      expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy();
    });

    test('a malformed outbox leaves the critique and download available with an explanation', async () => {
      vi.mocked(readRun).mockResolvedValue(RUN);
      vi.mocked(readThreads).mockResolvedValue(threadInfo);
      vi.mocked(readOutbox).mockRejectedValue('The outbox is malformed and was not changed.');
      await openRun(RUN.id);
      render(Comments);
      expect(screen.getByRole('heading', { name: 'Design critique' })).toBeTruthy();
      expect(screen.getByText(/outbox is malformed/)).toBeTruthy();
      expect(button('Download markdown')).toBeTruthy();
      expect(button('Unlock critique').disabled).toBe(true);
      expect(screen.queryByRole('button', { name: /Save \d+ updates?/ })).toBeNull();
    });

    test('a legacy snapshot remains readable and cannot enable forged controls', async () => {
      vi.mocked(readRun).mockResolvedValue({
        ...RUN,
        markdown: '# Legacy critique\n\n- [ ] **1**: Old comment\n\n<input type="checkbox">',
      });
      vi.mocked(readThreads).mockRejectedValue('Fetch a fresh run to queue actions.');
      await openRun(RUN.id);
      render(Comments);
      expect(screen.getByText(/Old comment/)).toBeTruthy();
      expect(screen.getByText(/Fetch a fresh run/)).toBeTruthy();
      expect(button('Unlock critique').disabled).toBe(true);
      expect(
        [
          ...screen.getByRole('heading', { name: 'Legacy critique' }).closest('.critique').querySelectorAll('input'),
        ].every((input) => input.disabled),
      ).toBe(true);
      expect(queueDone).not.toHaveBeenCalled();
    });
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
