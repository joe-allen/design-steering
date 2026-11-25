import {
  deleteAllRuns,
  deleteRun,
  discardAction,
  editReply,
  pushRun,
  queueDone,
  queueReply,
  readOutbox,
  readRun,
  readThreads,
  retryUncertain,
  savePartialExport as savePartialExportCommand,
  startRun,
  discardPartialExport as discardPartialExportCommand,
} from './api.js';
import {
  forgetPage,
  loadCritiqueLayout,
  loadLastPage,
  loadSettings,
  rememberPage,
  saveCritiqueLayout,
} from './settings.js';

/** State that must survive switching screens: what is shown, the form draft, and the run in progress. */
export const session = $state({
  screen: 'comments',
  run: null,
  pendingCandidate: null,
  critiqueLayout: 'single',
  critiqueLayoutReady: false,
  critiqueLayoutSaving: false,
  newPage: false,
  draft: { pageUrl: '', runName: '' },
  running: false,
  step: null,
  log: [],
  error: null,
  // Set when the error is about the token, so the screen can point to Settings.
  errorNeedsSettings: false,
  urlError: null,
  notice: null,
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

let openVersion = 0;
let actionsVersion = 0;
let draftSequence = 0;
let draftTimer = null;
let draftFlush = null;
let queueTail = Promise.resolve();
let queuedOperations = 0;

function clearActions() {
  actionsVersion++;
  clearTimeout(draftTimer);
  draftTimer = null;
  session.threadInfo = null;
  session.outbox = null;
  session.actionsError = null;
  session.actionsLoading = false;
  session.review = null;
  session.unlocked = false;
  session.replyDrafts = [];
}

function reconcileDrafts(outbox) {
  const replies = outbox.actions.filter(
    (action) => action.kind === 'reply' && ['pending', 'rejected'].includes(action.status),
  );
  for (const action of replies) {
    const draft = session.replyDrafts.find((item) => item.actionId === action.id);
    if (draft) {
      if (draft.text === draft.savedText) draft.text = action.text;
      draft.savedText = action.text;
    } else {
      session.replyDrafts.push({
        key: `saved:${action.id}`,
        rootId: action.rootId,
        actionId: action.id,
        text: action.text,
        savedText: action.text,
        error: null,
        discarding: false,
        pendingCreate: null,
      });
    }
  }
  session.replyDrafts = session.replyDrafts.filter((draft) => {
    if (!draft.actionId || replies.some((action) => action.id === draft.actionId)) return true;
    if (draft.text !== draft.savedText) {
      draft.error =
        'This reply can no longer be edited. Your unsaved text is still here; copy it or discard this local draft.';
      return true;
    }
    return false;
  });
}

async function loadRunActions(id) {
  const version = ++actionsVersion;
  session.actionsLoading = true;
  try {
    const info = await readThreads(id);
    const outbox = await readOutbox(id);
    if (version !== actionsVersion || session.run?.id !== id) return;
    session.threadInfo = info;
    session.outbox = outbox;
    session.actionsError = null;
    reconcileDrafts(outbox);
  } catch (error) {
    if (version !== actionsVersion || session.run?.id !== id) return;
    session.actionsError = String(error);
  } finally {
    if (version === actionsVersion && session.run?.id === id) session.actionsLoading = false;
  }
}

/** Restores the remembered page and preferred critique layout. */
export async function initSession() {
  session.critiqueLayoutReady = false;
  try {
    session.draft.pageUrl = await loadLastPage();
  } catch {
    // The form simply starts empty.
  }
  try {
    session.critiqueLayout = await loadCritiqueLayout();
  } catch (error) {
    session.critiqueLayout = 'single';
    session.error = `Could not load layout preference: ${error}`;
    session.errorNeedsSettings = false;
  } finally {
    session.critiqueLayoutReady = true;
  }
}

export async function toggleCritiqueLayout() {
  if (!session.critiqueLayoutReady || session.critiqueLayoutSaving) return;
  session.critiqueLayout = session.critiqueLayout === 'single' ? 'grid' : 'single';
  session.critiqueLayoutSaving = true;
  session.error = null;
  session.errorNeedsSettings = false;
  session.notice = null;
  try {
    await saveCritiqueLayout(session.critiqueLayout);
  } catch (error) {
    session.error = `Could not save layout preference: ${error}`;
  } finally {
    session.critiqueLayoutSaving = false;
  }
}

export async function openRun(id) {
  if (session.pendingCandidate) return;
  if (session.run && !(await finishLocalChanges())) return;
  const version = ++openVersion;
  session.screen = 'comments';
  try {
    const run = await readRun(id);
    if (version !== openVersion) return;
    clearActions();
    session.run = run;
    session.newPage = false;
    session.error = null;
    session.errorNeedsSettings = false;
    session.urlError = null;
    session.notice = null;
    await loadRunActions(id);
  } catch (error) {
    if (version === openVersion) session.error = String(error);
  }
}

async function performRun({ pageUrl, runName }, { remember }) {
  if (session.running || session.queueBusy || session.pendingCandidate) return;
  session.error = null;
  session.errorNeedsSettings = false;
  session.urlError = null;
  session.notice = null;
  session.log = [];
  session.step = null;

  let settings;
  try {
    settings = await loadSettings();
  } catch (error) {
    session.error = `Could not read settings: ${error}`;
    return;
  }
  const url = pageUrl.trim();
  if (!url) session.urlError = 'The Figma page URL is missing. Enter it above.';
  if (!settings.token.trim()) {
    session.error = 'The Figma token is missing. Add it in Settings.';
    session.errorNeedsSettings = true;
  }
  if (session.urlError || session.error) return;

  if (remember) {
    try {
      await rememberPage(url);
    } catch {
      // Not remembering the page must not stop the run.
    }
  }

  session.running = true;
  try {
    const outcome = await startRun({ ...settings, pageUrl: url, runName: runName.trim() }, (event) => {
      if (event.kind === 'step') session.step = event.step;
      else session.log.push(event.line);
    });
    if (outcome?.kind === 'completed' && outcome.runId) {
      await openRun(outcome.runId);
    } else if (outcome?.kind === 'partialCandidate' && outcome.candidateId && outcome.summary) {
      session.pendingCandidate = {
        candidateId: outcome.candidateId,
        summary: outcome.summary,
      };
    } else {
      throw new Error('The run returned an unsupported outcome.');
    }
  } catch (error) {
    session.error = String(error);
  } finally {
    session.running = false;
    session.step = null;
  }
}

export async function savePartialExport() {
  const candidate = session.pendingCandidate;
  if (!candidate || session.running) return;
  session.running = true;
  session.step = 'generate';
  session.log = [];
  session.error = null;
  session.errorNeedsSettings = false;
  session.notice = null;
  try {
    const id = await savePartialExportCommand(candidate.candidateId, (event) => {
      if (event.kind === 'step') session.step = event.step;
      else session.log.push(event.line);
    });
    session.pendingCandidate = null;
    await openRun(id);
  } catch (error) {
    session.pendingCandidate = null;
    session.error = String(error);
  } finally {
    session.running = false;
    session.step = null;
  }
}

export async function discardPartialExport() {
  const candidate = session.pendingCandidate;
  if (!candidate || session.running) return;
  session.running = true;
  session.step = 'discard';
  session.error = null;
  session.errorNeedsSettings = false;
  session.notice = null;
  try {
    await discardPartialExportCommand(candidate.candidateId);
    session.pendingCandidate = null;
  } catch (error) {
    session.pendingCandidate = null;
    session.error = String(error);
  } finally {
    session.running = false;
    session.step = null;
  }
}

/** Starts a run from what is typed in the Comments form. */
export const getComments = () => performRun(session.draft, { remember: true });

/** Fetches again the page the displayed run came from, leaving the form and remembered page alone. */
export async function syncRun() {
  if (!(await finishLocalChanges())) return;
  const source = session.run?.source;
  if (!source) {
    session.error = 'This run has no recorded page. Use New page to fetch a page.';
    session.errorNeedsSettings = false;
    return;
  }
  await performRun(source, { remember: false });
}

export async function startNewPage() {
  if (session.pendingCandidate) return;
  if ((session.queueBusy || session.replyDrafts.some(needsDraftSave)) && !(await finishLocalChanges())) return;
  session.review = null;
  session.newPage = true;
  session.draft.runName = '';
  session.error = null;
  session.errorNeedsSettings = false;
  session.urlError = null;
  session.notice = null;
}

export function backToComments() {
  session.newPage = false;
  session.error = null;
  session.errorNeedsSettings = false;
  session.urlError = null;
}

/** Each removal returns an error message, or null when it succeeded. */
export async function removeRun(id) {
  if (session.running || session.queueBusy || session.pendingCandidate)
    return 'A run is in progress. Try again when it has finished.';
  try {
    await deleteRun(id);
  } catch (error) {
    return String(error);
  }
  if (session.run?.id === id) {
    clearActions();
    session.run = null;
    session.newPage = false;
  }
  return null;
}

export async function removeAllRuns() {
  if (session.running || session.queueBusy || session.pendingCandidate)
    return 'A run is in progress. Try again when it has finished.';
  try {
    await deleteAllRuns();
  } catch (error) {
    await dropRunIfGone();
    return String(error);
  }
  clearActions();
  session.run = null;
  session.newPage = false;
  session.draft.pageUrl = '';
  try {
    await forgetPage();
  } catch (error) {
    return `The runs were removed, but the remembered page could not be cleared: ${error}`;
  }
  return null;
}

// After a partial failure, stop showing a run that was deleted.
async function dropRunIfGone() {
  if (!session.run) return;
  try {
    await readRun(session.run.id);
  } catch {
    clearActions();
    session.run = null;
    session.newPage = false;
  }
}

export const readyActions = (outbox) =>
  outbox?.actions.filter((action) => action.status === 'pending' || action.status === 'rejected') ?? [];

export function readyUpdateCount(outbox, drafts) {
  let count = readyActions(outbox).length;
  for (const draft of drafts) {
    const saved = readyActions(outbox).some((action) => action.id === draft.actionId);
    if (saved && !draft.text.trim()) count--;
    else if (!draft.actionId && draft.text.trim()) count++;
  }
  return count;
}

function changeQueue(command, ...args) {
  const id = session.run?.id;
  if (session.running || session.pendingCandidate || session.review || !id || !session.outbox || session.actionsError)
    return Promise.resolve(false);
  queuedOperations++;
  session.queueBusy = true;
  const operation = queueTail.then(async () => {
    if (session.run?.id !== id || !session.outbox) {
      session.error = 'The displayed run changed before the local update could be saved.';
      return false;
    }
    if (session.actionsError) {
      session.error = `Could not read the local queue: ${session.actionsError}`;
      return false;
    }
    session.error = null;
    session.errorNeedsSettings = false;
    session.notice = null;
    try {
      const outbox = await command(id, session.outbox.revision, ...args);
      if (session.run?.id === id) session.outbox = outbox;
      return true;
    } catch (error) {
      if (session.run?.id === id) {
        session.error = String(error);
        await loadRunActions(id);
      }
      return false;
    }
  });
  queueTail = operation.finally(() => {
    queuedOperations--;
    session.queueBusy = queuedOperations > 0;
  });
  return operation;
}

export const addReply = (rootId, text) => changeQueue(queueReply, rootId, text);
export const addDone = (rootId) => changeQueue(queueDone, rootId);
export const updateReply = (actionId, text) => changeQueue(editReply, actionId, text);
export const removeAction = (actionId) => changeQueue(discardAction, actionId);
export async function retryAction(actionId) {
  const retried = await changeQueue(retryUncertain, actionId, true);
  if (retried) reconcileDrafts(session.outbox);
  return retried;
}

function needsDraftSave(draft) {
  if (draft.discarding) return false;
  return draft.actionId ? draft.text !== draft.savedText : Boolean(draft.text.trim());
}

export function openReplyEditor(rootId) {
  if (
    !session.unlocked ||
    session.running ||
    session.pendingCandidate ||
    session.review ||
    session.transitionBusy ||
    !session.threadInfo?.threads.some((thread) => thread.rootId === rootId)
  )
    return;
  if (session.replyDrafts.some((draft) => draft.rootId === rootId && !draft.actionId && !draft.text.trim())) return;
  session.replyDrafts.push({
    key: `new:${++draftSequence}`,
    rootId,
    actionId: null,
    text: '',
    savedText: '',
    error: null,
    discarding: false,
    pendingCreate: null,
  });
}

export function updateDraft(key, text) {
  const draft = session.replyDrafts.find((item) => item.key === key);
  if (!draft || draft.discarding || !session.unlocked || session.review || session.transitionBusy) return;
  draft.text = text;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    void flushDrafts();
  }, 200);
}

async function flushDrafts() {
  clearTimeout(draftTimer);
  draftTimer = null;
  if (draftFlush) return draftFlush;
  const id = session.run?.id;
  draftFlush = (async () => {
    while (session.run?.id === id) {
      const draft = session.replyDrafts.find(needsDraftSave);
      if (!draft) return true;
      if (session.actionsError) {
        await loadRunActions(id);
        if (session.actionsError) {
          draft.error = `Could not save your reply: ${session.actionsError}`;
          session.error = draft.error;
          return false;
        }
      }
      if (draft.pendingCreate) {
        const { previousIds, text } = draft.pendingCreate;
        const possibleSave = session.outbox.actions.some(
          (item) =>
            !previousIds.includes(item.id) &&
            item.kind === 'reply' &&
            item.rootId === draft.rootId &&
            item.text === text,
        );
        if (possibleSave) {
          draft.error =
            'A matching reply may already have been saved. Compare it with this local draft before discarding the draft.';
          session.error = draft.error;
          return false;
        }
        draft.pendingCreate = null;
      }
      const text = draft.text;
      const actionId = draft.actionId;
      const action = session.outbox?.actions.find((item) => item.id === actionId);
      if (actionId && (!action || !['pending', 'rejected'].includes(action.status))) {
        draft.error =
          'This reply can no longer be edited. Your unsaved text is still here; copy it or discard this local draft.';
        session.error = draft.error;
        return false;
      }
      const previousIds = new Set(session.outbox.actions.map((item) => item.id));
      const saved = !actionId
        ? await addReply(draft.rootId, text)
        : text.trim()
          ? await updateReply(actionId, text)
          : await removeAction(actionId);
      if (!saved) {
        const current = session.outbox?.actions.find((item) => item.id === actionId);
        const persisted =
          actionId &&
          !session.actionsError &&
          (text.trim()
            ? current && ['pending', 'rejected'].includes(current.status) && current.text === text
            : !current);
        if (persisted) {
          draft.actionId = text.trim() ? actionId : null;
          draft.savedText = text.trim() ? text : '';
          draft.error = null;
          session.error = null;
          continue;
        }
        if (!actionId) draft.pendingCreate = { previousIds: [...previousIds], text };
        draft.error = `Could not save your reply: ${session.error || 'the local queue is unavailable.'}`;
        session.error = draft.error;
        return false;
      }
      if (!actionId) {
        const created = session.outbox.actions.filter(
          (item) =>
            !previousIds.has(item.id) && item.kind === 'reply' && item.rootId === draft.rootId && item.text === text,
        );
        if (created.length !== 1) {
          draft.pendingCreate = { previousIds: [...previousIds], text };
          draft.error = 'Could not identify the saved reply. Your text is still here; reopen the run before retrying.';
          session.error = draft.error;
          return false;
        }
        draft.actionId = created[0].id;
      } else if (!text.trim()) {
        draft.actionId = null;
      }
      draft.savedText = text.trim() ? text : '';
      draft.error = null;
    }
    return false;
  })();
  try {
    return await draftFlush;
  } finally {
    draftFlush = null;
  }
}

export async function discardDraft(key) {
  const draft = session.replyDrafts.find((item) => item.key === key);
  if (
    !draft ||
    draft.discarding ||
    session.running ||
    session.pendingCandidate ||
    session.review ||
    session.transitionBusy
  )
    return;
  draft.discarding = true;
  if (draftFlush) await draftFlush;
  const action = session.outbox?.actions.find((item) => item.id === draft.actionId);
  if (action && ['pending', 'rejected'].includes(action.status) && !(await removeAction(action.id))) {
    draft.discarding = false;
    draft.error = `Could not discard your reply: ${session.error || 'the local queue is unavailable.'}`;
    session.error = draft.error;
    return;
  }
  session.replyDrafts = session.replyDrafts.filter((item) => item.key !== key);
}

export async function retryDraftSave() {
  return flushDrafts();
}

export async function finishLocalChanges() {
  if (session.transitionBusy) return false;
  session.transitionBusy = true;
  try {
    const saved = await flushDrafts();
    await queueTail;
    return saved;
  } finally {
    session.transitionBusy = false;
  }
}

export async function lockCritique() {
  if (!session.unlocked || session.running || session.pendingCandidate || session.review) return;
  if (await finishLocalChanges()) session.unlocked = false;
}

export function unlockCritique() {
  if (
    !session.running &&
    !session.pendingCandidate &&
    !session.review &&
    !session.transitionBusy &&
    session.threadInfo &&
    session.outbox &&
    !session.actionsError
  ) {
    session.unlocked = true;
  }
}

export async function navigateTo(screen) {
  if (session.pendingCandidate) return;
  if (screen !== session.screen && !(await finishLocalChanges())) return;
  session.screen = screen;
}

export async function reviewPush() {
  if (
    session.running ||
    session.pendingCandidate ||
    session.review ||
    !session.unlocked ||
    !session.run ||
    !session.threadInfo ||
    !session.outbox
  )
    return;
  if (!(await finishLocalChanges())) return;
  if (session.actionsError) {
    session.error = `Could not review the local queue: ${session.actionsError}`;
    return;
  }
  const actions = readyActions(session.outbox);
  if (!actions.length) return;
  session.error = null;
  session.errorNeedsSettings = false;
  session.review = {
    runId: session.run.id,
    revision: session.outbox.revision,
    destination: session.threadInfo.destination,
    actions: actions.map((action) => ({ ...action })),
  };
}

export function cancelPushReview() {
  session.review = null;
}

export async function confirmPush() {
  const review = session.review && $state.snapshot(session.review);
  if (!review || session.running || session.pendingCandidate || session.queueBusy) return;
  if (
    session.run?.id !== review.runId ||
    session.outbox?.revision !== review.revision ||
    JSON.stringify(readyActions(session.outbox)) !== JSON.stringify(review.actions)
  ) {
    session.review = null;
    session.error = 'The queue changed after review. Review the current batch again.';
    if (session.run?.id === review.runId) await loadRunActions(review.runId);
    return;
  }
  session.review = null;
  session.running = true;
  session.step = 'push';
  session.log = [];
  session.error = null;
  session.errorNeedsSettings = false;
  session.notice = null;
  try {
    const settings = await loadSettings();
    if (!settings.token.trim()) {
      throw new Error('The Figma token is missing. Add it in Settings.');
    }
    if (session.run?.id !== review.runId || session.outbox?.revision !== review.revision) {
      throw new Error('The queue changed after review. Review the current batch again.');
    }
    await pushRun(review.runId, review.revision, { token: settings.token, nodePath: settings.nodePath }, (event) => {
      if (event.kind === 'step') session.step = event.step;
      else session.log.push(event.line);
    });
    if (session.run?.id === review.runId) session.notice = 'Push finished. Review the results below.';
  } catch (error) {
    session.error = String(error);
    session.errorNeedsSettings = /\b(?:401|403)\b|token|file_comments:write/i.test(session.error);
  } finally {
    if (session.run?.id === review.runId) await loadRunActions(review.runId);
    session.running = false;
    session.step = null;
  }
}
