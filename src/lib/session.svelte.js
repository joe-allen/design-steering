import { deleteAllRuns, deleteRun, readRun, startRun } from './api.js';
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
});

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
  session.screen = 'comments';
  try {
    session.run = await readRun(id);
    session.newPage = false;
    session.error = null;
    session.errorNeedsSettings = false;
    session.urlError = null;
    session.notice = null;
  } catch (error) {
    session.error = String(error);
  }
}

async function performRun({ pageUrl, runName }, { remember }) {
  if (session.running) return;
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
    const id = await startRun({ ...settings, pageUrl: url, runName: runName.trim() }, (event) => {
      if (event.kind === 'step') session.step = event.step;
      else session.log.push(event.line);
    });
    await openRun(id);
  } catch (error) {
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
  const source = session.run?.source;
  if (!source) {
    session.error = 'This run has no recorded page. Use New page to fetch a page.';
    session.errorNeedsSettings = false;
    return;
  }
  await performRun(source, { remember: false });
}

export function startNewPage() {
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
  if (session.running) return 'A run is in progress. Try again when it has finished.';
  try {
    await deleteRun(id);
  } catch (error) {
    return String(error);
  }
  if (session.run?.id === id) {
    session.run = null;
    session.newPage = false;
  }
  return null;
}

export async function removeAllRuns() {
  if (session.running) return 'A run is in progress. Try again when it has finished.';
  try {
    await deleteAllRuns();
  } catch (error) {
    await dropRunIfGone();
    return String(error);
  }
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
    session.run = null;
    session.newPage = false;
  }
}
