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
