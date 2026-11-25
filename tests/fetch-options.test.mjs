import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repo, '_1-fetch-figma-comments.mjs');
const stub = join(repo, 'tests', 'stub-figma.mjs');
const URL_ARG = 'https://www.figma.com/design/KEY/file?node-id=1-1';

const temps = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fetch-test-'));
  temps.push(dir);
  return dir;
};
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function runFetch(scriptPath, args, url = URL_ARG) {
  return spawnSync(process.execPath, ['--import', stub, scriptPath, url, '--token=test', '--images=false', ...args], {
    encoding: 'utf8',
    env: { ...process.env, FIGMA_TOKEN: '', FIGMA_PAGE_URL: '' },
  });
}

test('branch snapshots preserve root and reply identity alongside display fields', () => {
  const out = tempDir();
  const result = runFetch(script, [`--out=${out}`], 'https://www.figma.com/design/KEY/branch/BRANCH/file?node-id=1-1');
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(readFileSync(join(out, 'checkout-design-critique', 'checkout-figma-comments.json'), 'utf8'));
  assert.deepEqual(rows[0], {
    file_key: 'BRANCH',
    id: 'c1',
    parent_id: null,
    has_done_reaction: true,
    frame: '1. Frame A',
    comment_thread: '1',
    user: 'ada',
    message: 'Make this bigger',
    reactions: ':white_check_mark: (grace)',
    link: 'https://www.figma.com/file/BRANCH?node-id=2%3A2#c1',
    created_at: '2026-01-01T00:00:00Z',
    resolved_at: null,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].file_key, 'BRANCH');
  assert.equal(rows[1].id, 'c2');
  assert.equal(rows[1].parent_id, 'c1');
  assert.equal(rows[1].comment_thread, rows[0].comment_thread);
  assert.equal(rows[1].has_done_reaction, false);
});

test('a frame link exports deeply nested pins and replies when file-wide lookups return 500', () => {
  const out = tempDir();
  const result = runFetch(script, [`--out=${out}`], 'https://www.figma.com/design/LARGE/file?node-id=2-2');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /500.*retry/i);
  assert.doesNotMatch(result.stderr, /No position for pin/);
  const rows = JSON.parse(readFileSync(join(out, 'checkout-design-critique', 'checkout-figma-comments.json'), 'utf8'));
  assert.deepEqual(
    rows.map(({ id, frame, comment_thread }) => [id, frame, comment_thread]),
    [
      ['c1', '1. Frame A', '1'],
      ['c2', '1. Frame A', '1'],
    ],
  );
});

test('a persistent Figma server error fails the fetch without writing a partial run', () => {
  const out = tempDir();
  const result = runFetch(script, [`--out=${out}`], 'https://www.figma.com/design/DOWN/file?node-id=1-1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Figma returned 500 while matching pins to frames.*Try again later/i);
  assert.deepEqual(readdirSync(out), []);
});

test('desktop recovery keeps confirmed ancestor and sibling threads when one layer branch stays unreadable', () => {
  const out = tempDir();
  const result = runFetch(
    script,
    [`--out=${out}`, '--desktop-partial'],
    'https://www.figma.com/design/PARTIAL/file?node-id=1-1',
  );
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(readFileSync(join(out, 'checkout-design-critique', 'checkout-figma-comments.json'), 'utf8'));
  assert.deepEqual(
    rows.map(({ id }) => id),
    ['c1', 'c1-reply', 'c2'],
  );
  assert.equal(rows.filter(({ id }) => id === 'c1-reply').length, 1);
  const report = JSON.parse(readFileSync(join(out, 'checkout-design-critique', 'partial-report.json'), 'utf8'));
  assert.equal(report.version, 1);
  assert.equal(report.confirmed_threads, 2);
  assert.deepEqual(report.unreadable[0].path.slice(-1), [{ id: '6:2', name: 'Shared name' }]);
  assert.deepEqual(report.unexamined, []);
});

test('desktop recovery stops at its finite request budget and reports unchecked branches separately', () => {
  const out = tempDir();
  const result = runFetch(
    script,
    [`--out=${out}`, '--desktop-partial'],
    'https://www.figma.com/design/BUDGET/file?node-id=1-1',
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(out, 'checkout-design-critique', 'partial-report.json'), 'utf8'));
  assert.equal(report.version, 1);
  assert.equal(report.recovery_requests, 64);
  assert.ok(report.unexamined.length > 0);
  assert.ok(report.unreadable.length > 0);
  assert.equal(report.confirmed_threads, 1);
});

test('a fully recovered desktop scan does not produce a partial report', () => {
  const out = tempDir();
  const result = runFetch(
    script,
    [`--out=${out}`, '--desktop-partial'],
    'https://www.figma.com/design/LARGE/file?node-id=2-2',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(out, 'checkout-design-critique', 'partial-report.json')), false);
});

test('an incomplete scan with no confirmed page threads cannot create a candidate', () => {
  const out = tempDir();
  const result = runFetch(
    script,
    [`--out=${out}`, '--desktop-partial'],
    'https://www.figma.com/design/EMPTY_PARTIAL/file?node-id=1-1',
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /incomplete.*no comments could be confirmed.*nothing can be saved/i);
  assert.deepEqual(readdirSync(out), []);
});

test('denied access, exhausted rate limit, and failed page or comments requests never create candidates', () => {
  const cases = [
    ['DENIED', /403/],
    ['RATE', /429/],
    ['PAGEFAIL', /500.*listing pages/],
    ['COMMENTSFAIL', /500.*fetching comments/],
  ];
  for (const [key, message] of cases) {
    const out = tempDir();
    const result = runFetch(
      script,
      [`--out=${out}`, '--desktop-partial'],
      `https://www.figma.com/design/${key}/file?node-id=1-1`,
    );
    assert.equal(result.status, 1, key);
    assert.match(result.stderr, message, key);
    assert.deepEqual(readdirSync(out), [], key);
  }
});

test('default: run folder is created next to the script', () => {
  const dir = tempDir();
  const copy = join(dir, '_1-fetch-figma-comments.mjs');
  copyFileSync(script, copy);
  const result = runFetch(copy, []);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(dir, 'checkout-design-critique', 'checkout-figma-comments.json')));
});

test('--out: run folder is created inside the given folder, which is created if missing', () => {
  const out = join(tempDir(), 'runs');
  const result = runFetch(script, [`--out=${out}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(out), ['checkout-design-critique']);
});

test('--print-run-dir: last stdout line is the absolute run folder', () => {
  const out = tempDir();
  const result = runFetch(script, [`--out=${out}`, '--print-run-dir']);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.at(-1), join(out, 'checkout-design-critique'));
});

test('--print-run-dir: repeat runs print the numbered folder', () => {
  const out = tempDir();
  runFetch(script, [`--out=${out}`]);
  const result = runFetch(script, [`--out=${out}`, '--print-run-dir']);
  assert.equal(result.stdout.trimEnd().split('\n').at(-1), join(out, 'checkout-design-critique-1'));
});

test('without --print-run-dir the output is unchanged', () => {
  const result = runFetch(script, [`--out=${tempDir()}`]);
  assert.match(result.stdout.trimEnd().split('\n').at(-1), /^Wrote .* \(1 comments across 1 frames\)$/);
});

test('title.txt holds the Figma page name when no --name is given', () => {
  const out = tempDir();
  const result = runFetch(script, [`--out=${out}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(out, 'checkout-design-critique', 'title.txt'), 'utf8'), 'Checkout\n');
});

test('title.txt holds --name exactly as given, while the folder name is slugified', () => {
  const out = tempDir();
  const result = runFetch(script, [`--out=${out}`, '--name=  Checkout   Flow ']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(out, 'checkout-flow-design-critique', 'title.txt'), 'utf8'), 'Checkout Flow\n');
});
