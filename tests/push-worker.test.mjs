import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repo, '_3-push-figma-comments.mjs');
const stub = join(repo, 'tests', 'stub-push-figma.mjs');
const TOKEN = 'fake-private-token';
const temps = [];

after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const root = (id, pin) => ({
  file_key: 'BRANCH',
  id,
  parent_id: null,
  has_done_reaction: false,
  frame: '1. Home',
  comment_thread: pin,
  user: 'ada',
  message: `Comment ${pin}`,
});
const reply = (id, rootId, text) => ({
  id: `action-${id}`,
  rootId,
  kind: 'reply',
  status: 'pending',
  text,
});
const done = (id, rootId) => ({ id: `action-${id}`, rootId, kind: 'done', status: 'pending' });
const live = (id, reactions = []) => ({ id, parent_id: null, reactions });

function fixture(actions) {
  const temp = mkdtempSync(join(tmpdir(), 'push-test-'));
  temps.push(temp);
  const dir = join(temp, 'checkout-design-critique');
  mkdirSync(dir);
  writeFileSync(join(dir, 'checkout-design-critique.md'), '# Critique\n');
  writeFileSync(
    join(dir, 'source.json'),
    JSON.stringify({
      pageUrl: 'https://www.figma.com/design/FILE/branch/BRANCH/page?node-id=1-1',
      runName: 'checkout',
    }),
  );
  writeFileSync(
    join(dir, 'checkout-figma-comments.json'),
    JSON.stringify([root('root-1', '1'), { ...root('reply-1', '1'), parent_id: 'root-1' }, root('root-2', '2')]),
  );
  writeFileSync(join(dir, 'outbox.json'), JSON.stringify({ version: 1, revision: actions.length, actions }));
  return { temp, dir };
}

function outbox(dir) {
  return JSON.parse(readFileSync(join(dir, 'outbox.json'), 'utf8'));
}

function launch({ temp, dir }, scenario, revision, extraEnv = {}) {
  const scenarioFile = join(temp, 'scenario.json');
  const requestFile = join(temp, 'requests.jsonl');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  writeFileSync(requestFile, '');
  const child = spawn(process.execPath, ['--import', stub, script, dir, String(revision)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FIGMA_TOKEN: TOKEN,
      PUSH_STUB_SCENARIO: scenarioFile,
      PUSH_STUB_REQUESTS: requestFile,
      ...extraEnv,
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return {
    child,
    finished,
    requests: () => readFileSync(requestFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
  };
}

test('posts replies and reactions to the branch and root IDs with exact payloads', async () => {
  const run = fixture([reply(1, 'root-1', 'A private reply'), done(2, 'root-2')]);
  const worker = launch(
    run,
    {
      comments: [live('root-1'), { id: 'reply-1', parent_id: 'root-1' }, live('root-2')],
      posts: [{ status: 201, body: { id: 'new-reply', parent_id: 'root-1' } }, { status: 204 }],
    },
    2,
  );
  const result = await worker.finished;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(worker.requests(), [
    { method: 'GET', url: 'https://api.figma.com/v1/files/BRANCH/comments', body: null, redirect: 'error' },
    {
      method: 'POST',
      url: 'https://api.figma.com/v1/files/BRANCH/comments',
      body: { message: 'A private reply', comment_id: 'root-1' },
      redirect: 'error',
    },
    {
      method: 'POST',
      url: 'https://api.figma.com/v1/files/BRANCH/comments/root-2/reactions',
      body: { emoji: ':white_check_mark:' },
      redirect: 'error',
    },
  ]);
  assert.deepEqual(
    outbox(run.dir).actions.map((action) => action.status),
    ['confirmed', 'confirmed'],
  );
  assert.equal(outbox(run.dir).actions[0].figmaReplyId, 'new-reply');
  assert.doesNotMatch(result.stderr + result.stdout, /fake-private-token|A private reply/);
});

test('an existing check mark is reported without a POST', async () => {
  const run = fixture([done(1, 'root-2')]);
  const worker = launch(
    run,
    {
      comments: [live('root-2', [{ emoji: ':white_check_mark:' }])],
    },
    1,
  );
  const result = await worker.finished;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(worker.requests().length, 1);
  assert.equal(outbox(run.dir).actions[0].status, 'alreadyDone');
});

test('missing roots, wrong destinations, non-root targets, and stale reviews never post', async () => {
  const missing = fixture([reply(1, 'root-1', 'private')]);
  let worker = launch(missing, { comments: [live('root-2')] }, 1);
  assert.equal((await worker.finished).code, 0);
  assert.deepEqual(
    worker.requests().map((request) => request.method),
    ['GET'],
  );
  assert.equal(outbox(missing.dir).actions[0].status, 'rejected');

  const wrong = fixture([reply(1, 'root-1', 'private')]);
  writeFileSync(
    join(wrong.dir, 'source.json'),
    JSON.stringify({
      pageUrl: 'https://www.figma.com/design/OTHER/page?node-id=1-1',
      runName: '',
    }),
  );
  worker = launch(wrong, { comments: [live('root-1')] }, 1);
  assert.equal((await worker.finished).code, 1);
  assert.deepEqual(worker.requests(), []);

  const nonRoot = fixture([reply(1, 'reply-1', 'private')]);
  worker = launch(nonRoot, { comments: [live('root-1')] }, 1);
  assert.equal((await worker.finished).code, 1);
  assert.deepEqual(worker.requests(), []);

  const stale = fixture([reply(1, 'root-1', 'private')]);
  worker = launch(stale, { comments: [live('root-1')] }, 0);
  const result = await worker.finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /changed after review/);
  assert.deepEqual(worker.requests(), []);
  assert.equal(outbox(stale.dir).revision, 1);
});

test('a definite rejection preserves successes and only the rejected reply is retried', async () => {
  const run = fixture([
    reply(1, 'root-1', 'first private reply'),
    reply(2, 'root-2', 'second private reply'),
    reply(3, 'root-1', 'third private reply'),
  ]);
  let worker = launch(
    run,
    {
      comments: [live('root-1'), live('root-2')],
      posts: [
        { status: 201, body: { id: 'sent-1', parent_id: 'root-1' } },
        { status: 400 },
        { status: 201, body: { id: 'sent-3', parent_id: 'root-1' } },
      ],
    },
    3,
  );
  assert.equal((await worker.finished).code, 0);
  let saved = outbox(run.dir);
  assert.deepEqual(
    saved.actions.map((action) => action.status),
    ['confirmed', 'rejected', 'confirmed'],
  );
  worker = launch(
    run,
    {
      comments: [live('root-1'), live('root-2')],
      posts: [{ status: 201, body: { id: 'sent-2', parent_id: 'root-2' } }],
    },
    saved.revision,
  );
  assert.equal((await worker.finished).code, 0);
  assert.deepEqual(
    worker
      .requests()
      .filter((request) => request.method === 'POST')
      .map((request) => request.body),
    [{ message: 'second private reply', comment_id: 'root-2' }],
  );
  saved = outbox(run.dir);
  assert.deepEqual(
    saved.actions.map((action) => action.status),
    ['confirmed', 'confirmed', 'confirmed'],
  );
});

for (const status of [403, 429]) {
  test(`${status} stops the batch and leaves later actions queued`, async () => {
    const run = fixture([reply(1, 'root-1', 'private one'), reply(2, 'root-2', 'private two')]);
    const worker = launch(run, { comments: [live('root-1'), live('root-2')], posts: [{ status }] }, 2);
    const result = await worker.finished;
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(String(status)));
    assert.doesNotMatch(result.stderr + result.stdout, /fake-private-token|private one|private two/);
    assert.deepEqual(
      outbox(run.dir).actions.map((action) => action.status),
      ['rejected', 'pending'],
    );
    assert.equal(worker.requests().filter((request) => request.method === 'POST').length, 1);
  });
}

test('response loss marks the attempt uncertain and does not retry it automatically', async () => {
  const run = fixture([reply(1, 'root-1', 'uncertain'), reply(2, 'root-2', 'still pending')]);
  let worker = launch(run, { comments: [live('root-1'), live('root-2')], posts: [{ throw: true }] }, 2);
  assert.equal((await worker.finished).code, 1);
  const saved = outbox(run.dir);
  assert.deepEqual(
    saved.actions.map((action) => action.status),
    ['uncertain', 'pending'],
  );
  worker = launch(
    run,
    {
      comments: [live('root-1'), live('root-2')],
      posts: [{ status: 201, body: { id: 'sent-2', parent_id: 'root-2' } }],
    },
    saved.revision,
  );
  assert.equal((await worker.finished).code, 0);
  assert.deepEqual(
    worker
      .requests()
      .filter((request) => request.method === 'POST')
      .map((request) => request.body.comment_id),
    ['root-2'],
  );
  assert.deepEqual(
    outbox(run.dir).actions.map((action) => action.status),
    ['uncertain', 'confirmed'],
  );
});

test('a failed post-response checkpoint leaves the attempt in flight and stops the batch', async () => {
  const run = fixture([reply(1, 'root-1', 'private one'), reply(2, 'root-2', 'private two')]);
  const worker = launch(
    run,
    {
      comments: [live('root-1'), live('root-2')],
      posts: [{ status: 201, body: { id: 'sent-1', parent_id: 'root-1' } }],
    },
    2,
    { PUSH_STUB_FAIL_RENAME: '2' },
  );
  const result = await worker.finished;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /checkpoint/);
  assert.deepEqual(
    outbox(run.dir).actions.map((action) => action.status),
    ['inFlight', 'pending'],
  );
  assert.equal(worker.requests().filter((request) => request.method === 'POST').length, 1);
});

test('an interrupted delivery leaves an in-flight checkpoint and later actions untouched', async () => {
  const run = fixture([reply(1, 'root-1', 'private one'), reply(2, 'root-2', 'private two')]);
  const worker = launch(
    run,
    {
      comments: [live('root-1'), live('root-2')],
      posts: [{ hang: true }],
    },
    2,
  );
  const deadline = Date.now() + 5000;
  while (worker.requests().filter((request) => request.method === 'POST').length === 0) {
    assert.ok(Date.now() < deadline, 'worker did not dispatch the stubbed request');
    await delay(10);
  }
  worker.child.kill('SIGKILL');
  await worker.finished;
  assert.deepEqual(
    outbox(run.dir).actions.map((action) => action.status),
    ['inFlight', 'pending'],
  );
});
