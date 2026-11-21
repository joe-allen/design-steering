import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

const API = 'https://api.figma.com/v1';
const DONE = ':white_check_mark:';
const FRESH_RUN = 'Fetch a fresh run to queue actions.';
const statuses = new Set(['pending', 'inFlight', 'confirmed', 'rejected', 'uncertain', 'alreadyDone']);
let parentAlive = true;
let temporaryNumber = 0;
const parentAbort = new AbortController();

function parentGone() {
  parentAlive = false;
  parentAbort.abort();
}
process.stdin.on('end', parentGone);
process.stdin.on('error', parentGone);
process.stdin.resume();

class PushError extends Error {}

function regularFile(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new PushError(`The run is missing a required snapshot or outbox file. ${FRESH_RUN}`);
  }
  if (!stat.isFile()) throw new PushError(`A run file is not a regular file. ${FRESH_RUN}`);
}

function readJson(path, description) {
  regularFile(path);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new PushError(`The ${description} could not be read or is malformed.`);
  }
}

function destinationKey(source) {
  let url;
  try {
    url = new URL(source.pageUrl);
  } catch {
    throw new PushError(`The recorded Figma destination is invalid. ${FRESH_RUN}`);
  }
  if (
    !['https://figma.com', 'https://www.figma.com'].includes(url.origin) ||
    url.username ||
    url.password ||
    !url.searchParams.get('node-id')
  )
    throw new PushError(`The recorded Figma destination is invalid. ${FRESH_RUN}`);
  const file = /^\/(?:design|file|board)\/([^/]+)/.exec(url.pathname);
  const branch = /\/branch\/([^/]+)/.exec(url.pathname);
  const key = branch?.[1] ?? file?.[1];
  if (!file || !key || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new PushError(`The recorded Figma destination is invalid. ${FRESH_RUN}`);
  }
  return key;
}

function snapshotRoots(rows, fileKey) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new PushError(`The run has invalid Figma thread metadata. ${FRESH_RUN}`);
  }
  const all = new Map();
  const roots = new Map();
  for (const row of rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      row.file_key !== fileKey ||
      typeof row.id !== 'string' ||
      !row.id.trim() ||
      row.id === '.' ||
      row.id === '..' ||
      !Object.hasOwn(row, 'parent_id') ||
      typeof row.has_done_reaction !== 'boolean' ||
      typeof row.frame !== 'string' ||
      !row.frame.trim() ||
      typeof row.comment_thread !== 'string' ||
      !row.comment_thread.trim() ||
      typeof row.message !== 'string' ||
      typeof row.user !== 'string' ||
      all.has(row.id)
    )
      throw new PushError(`The run has invalid Figma thread metadata. ${FRESH_RUN}`);
    all.set(row.id, row);
    if (row.parent_id === null) roots.set(row.id, row);
  }
  if (!roots.size) throw new PushError(`The run has invalid Figma thread metadata. ${FRESH_RUN}`);
  for (const row of rows) {
    if (row.parent_id === null) continue;
    const root = typeof row.parent_id === 'string' && roots.get(row.parent_id);
    if (!root || root.frame !== row.frame || root.comment_thread !== row.comment_thread) {
      throw new PushError(`The run has invalid Figma thread metadata. ${FRESH_RUN}`);
    }
  }
  return roots;
}

function validateOutbox(outbox, roots, reviewedRevision) {
  if (
    !outbox ||
    typeof outbox !== 'object' ||
    Array.isArray(outbox) ||
    Object.keys(outbox).some((key) => !['version', 'revision', 'actions'].includes(key)) ||
    outbox.version !== 1 ||
    !Number.isSafeInteger(outbox.revision) ||
    outbox.revision < 0 ||
    !Array.isArray(outbox.actions)
  )
    throw new PushError('The outbox is malformed or has an unsupported version; it was not changed.');
  if (outbox.revision !== reviewedRevision) {
    throw new PushError('The queue changed after review. Review the current batch again.');
  }
  const ids = new Set();
  const doneRoots = new Set();
  const fields = new Set(['id', 'rootId', 'kind', 'status', 'text', 'error', 'figmaReplyId', 'updatedAt']);
  for (const action of outbox.actions) {
    const sequence = typeof action?.id === 'string' && /^action-([1-9]\d*)$/.exec(action.id);
    if (
      !action ||
      typeof action !== 'object' ||
      Array.isArray(action) ||
      Object.keys(action).some((field) => !fields.has(field)) ||
      !sequence ||
      !Number.isSafeInteger(Number(sequence[1])) ||
      Number(sequence[1]) > outbox.revision ||
      ids.has(action.id) ||
      !roots.has(action.rootId) ||
      !['reply', 'done'].includes(action.kind) ||
      !statuses.has(action.status) ||
      (action.kind === 'reply' && (typeof action.text !== 'string' || !action.text.trim())) ||
      (action.kind === 'done' && (action.text != null || doneRoots.has(action.rootId))) ||
      ['error', 'figmaReplyId', 'updatedAt'].some((key) => action[key] != null && typeof action[key] !== 'string')
    )
      throw new PushError('The outbox is malformed and was not changed.');
    ids.add(action.id);
    if (action.kind === 'done') doneRoots.add(action.rootId);
  }
}

function checkpoint(dir, outbox) {
  if (!Number.isSafeInteger(outbox.revision + 1)) throw new PushError('The outbox revision is exhausted.');
  outbox.revision++;
  const target = join(dir, 'outbox.json');
  const temporary = join(dir, `.outbox-${process.pid}-push-${temporaryNumber++}.tmp`);
  let fd;
  let created = false;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    created = true;
    writeFileSync(fd, `${JSON.stringify(outbox, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, target);
    created = false;
    if (process.platform !== 'win32') {
      const directory = openSync(dir, 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  } catch {
    if (fd !== undefined) closeSync(fd);
    if (created) {
      try {
        unlinkSync(temporary);
      } catch {
        /* Leave a non-exported temporary file on cleanup failure. */
      }
    }
    throw new PushError('Could not save the push checkpoint. Check Figma before retrying an in-flight action.');
  }
}

function record(dir, outbox, action, status, error) {
  action.status = status;
  action.updatedAt = new Date().toISOString();
  if (error) action.error = error;
  else delete action.error;
  checkpoint(dir, outbox);
}

function statusMessage(status) {
  if (status === 401 || status === 403) {
    return `Figma returned ${status}. Check the saved token's file_comments:write scope and file access in Settings.`;
  }
  if (status === 404) return 'Figma returned 404. The file or thread was not found or is inaccessible.';
  if (status === 429) return 'Figma returned 429. The rate limit was reached; try again later.';
  return `Figma returned ${status}.`;
}

async function main() {
  const [dir, revisionText, ...extra] = process.argv.slice(2);
  if (!dir || !/^(?:0|[1-9]\d*)$/.test(revisionText ?? '') || extra.length) {
    throw new PushError('A run and reviewed outbox revision are required.');
  }
  const reviewedRevision = Number(revisionText);
  if (!Number.isSafeInteger(reviewedRevision)) throw new PushError('The reviewed revision is invalid.');
  const token = (process.env.FIGMA_TOKEN ?? '').trim();
  if (!token) throw new PushError('The Figma token is missing. Add it in Settings.');

  const name = basename(dir);
  const match = /^([A-Za-z0-9-]+)-design-critique(-\d+)?$/.exec(name);
  if (!match || !lstatSync(dir).isDirectory()) throw new PushError('The run folder is invalid.');
  regularFile(join(dir, `${name}.md`));
  const source = readJson(join(dir, 'source.json'), 'run source');
  if (!source || typeof source.pageUrl !== 'string' || typeof source.runName !== 'string') {
    throw new PushError(`The run source is invalid. ${FRESH_RUN}`);
  }
  const key = destinationKey(source);
  const rows = readJson(join(dir, `${match[1]}-figma-comments${match[2] ?? ''}.json`), 'comments snapshot');
  const roots = snapshotRoots(rows, key);
  const outbox = readJson(join(dir, 'outbox.json'), 'outbox');
  validateOutbox(outbox, roots, reviewedRevision);
  const eligible = outbox.actions.filter((action) => ['pending', 'rejected'].includes(action.status));
  if (!eligible.length) throw new PushError('There are no reviewed actions ready to push.');
  if (!parentAlive) throw new PushError('The push was cancelled because the app closed.');

  let response;
  try {
    response = await fetch(`${API}/files/${encodeURIComponent(key)}/comments`, {
      headers: { 'X-Figma-Token': token },
      redirect: 'error',
      signal: parentAbort.signal,
    });
  } catch {
    throw new PushError('Could not check the current Figma comments. No actions were sent.');
  }
  if (!response.ok) throw new PushError(`${statusMessage(response.status)} No actions were sent.`);
  let comments;
  try {
    ({ comments } = await response.json());
  } catch {
    throw new PushError('Figma returned an invalid comments response. No actions were sent.');
  }
  if (!Array.isArray(comments))
    throw new PushError('Figma returned an invalid comments response. No actions were sent.');
  const current = new Map();
  for (const comment of comments) {
    if (!comment || typeof comment.id !== 'string' || !comment.id || current.has(comment.id)) {
      throw new PushError('Figma returned an invalid comments response. No actions were sent.');
    }
    current.set(comment.id, comment);
  }

  for (const action of eligible) {
    await new Promise((resolve) => setImmediate(resolve));
    if (!parentAlive) throw new PushError('The app closed; no further actions were sent.');
    const root = current.get(action.rootId);
    if (!root || root.parent_id) {
      record(dir, outbox, action, 'rejected', 'The root thread no longer exists in this Figma file.');
      continue;
    }
    if (action.kind === 'done') {
      if (!Array.isArray(root.reactions)) {
        record(dir, outbox, action, 'rejected', 'Figma did not provide the thread reactions; no mark was sent.');
        continue;
      }
      if (root.reactions.some((reaction) => reaction?.emoji === DONE)) {
        record(dir, outbox, action, 'alreadyDone');
        continue;
      }
    }

    record(dir, outbox, action, 'inFlight');
    const path =
      action.kind === 'reply'
        ? `/files/${encodeURIComponent(key)}/comments`
        : `/files/${encodeURIComponent(key)}/comments/${encodeURIComponent(action.rootId)}/reactions`;
    const body = action.kind === 'reply' ? { message: action.text, comment_id: action.rootId } : { emoji: DONE };
    try {
      response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'X-Figma-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: parentAbort.signal,
      });
    } catch {
      record(dir, outbox, action, 'uncertain', 'The response was lost. Check Figma before retrying.');
      throw new PushError('The push was interrupted. Check Figma before retrying the uncertain action.');
    }

    if (response.ok && action.kind === 'reply') {
      let reply;
      try {
        reply = await response.json();
      } catch {
        reply = null;
      }
      if (
        !reply ||
        typeof reply.id !== 'string' ||
        !reply.id.trim() ||
        reply.parent_id !== action.rootId ||
        current.has(reply.id)
      ) {
        record(
          dir,
          outbox,
          action,
          'uncertain',
          'Figma did not confirm the expected reply. Check Figma before retrying.',
        );
        throw new PushError('Figma returned an ambiguous reply result. Check Figma before retrying.');
      }
      action.figmaReplyId = reply.id;
      current.set(reply.id, reply);
    }
    if (response.ok) {
      record(dir, outbox, action, 'confirmed');
      console.error('An action was confirmed.');
      continue;
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      record(dir, outbox, action, 'rejected', statusMessage(response.status));
      if (![401, 403, 404, 429].includes(response.status)) continue;
      throw new PushError(statusMessage(response.status));
    }
    record(dir, outbox, action, 'uncertain', 'Figma returned an uncertain result. Check Figma before retrying.');
    throw new PushError('Figma returned an uncertain result. Check Figma before retrying.');
  }
  console.error('Push finished. Review the results on this run.');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof PushError ? error.message : 'The push stopped because of an unexpected local error.');
  process.exitCode = 1;
} finally {
  process.stdin.destroy();
}
