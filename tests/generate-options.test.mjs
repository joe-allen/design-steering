import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repo, '_2-generate-design-critique.mjs');

const temps = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'generate-test-'));
  temps.push(dir);
  return dir;
};
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const comment = (message) => ({
  frame: '1. Frame A',
  comment_thread: '1',
  user: 'ada',
  message,
  reactions: '',
  link: '',
  created_at: '2026-01-01T00:00:00Z',
  resolved_at: null,
});

function makeRun(parent, name, { frames = false, message = 'Make this bigger', ageSeconds = 0 } = {}) {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name.replace(/-design-critique.*$/, '')}-figma-comments.json`),
    JSON.stringify([comment(message)]),
  );
  if (frames) {
    mkdirSync(join(dir, '_frames'));
    writeFileSync(join(dir, '_frames', '1-frame-a.png'), '');
  }
  const when = new Date(Date.now() - ageSeconds * 1000);
  utimesSync(dir, when, when);
  return dir;
}

const run = (scriptPath, args) => spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });

test('--out: finds the newest run folder in the given folder', () => {
  const out = tempDir();
  makeRun(out, 'old-design-critique', { message: 'old comment', ageSeconds: 60 });
  makeRun(out, 'new-design-critique', { message: 'new comment' });
  const result = run(script, [`--out=${out}`]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(out, 'new-design-critique', 'new-design-critique.md'), 'utf8'), /new comment/);
  assert.ok(!existsSync(join(out, 'old-design-critique', 'old-design-critique.md')));
});

test('default: looks next to the script', () => {
  const dir = tempDir();
  copyFileSync(script, join(dir, '_2-generate-design-critique.mjs'));
  makeRun(dir, 'home-design-critique');
  const result = run(join(dir, '_2-generate-design-critique.mjs'), []);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(dir, 'home-design-critique', 'home-design-critique.md')));
});

test('a run folder without _frames lists every comment under General comments', () => {
  const dir = makeRun(tempDir(), 'noimg-design-critique');
  const result = run(script, [dir]);
  assert.equal(result.status, 0, result.stderr);
  const md = readFileSync(join(dir, 'noimg-design-critique.md'), 'utf8');
  assert.match(md, /## General comments\n\n- \[ \] \*\*1\*\*: Make this bigger/);
  assert.doesNotMatch(md, /<img/);
});

test('a run folder with _frames still places comments under their image', () => {
  const dir = makeRun(tempDir(), 'img-design-critique', { frames: true });
  const result = run(script, [dir]);
  assert.equal(result.status, 0, result.stderr);
  const md = readFileSync(join(dir, 'img-design-critique.md'), 'utf8');
  assert.match(md, /<img src="\.\/_frames\/1-frame-a\.png"/);
  assert.doesNotMatch(md, /General comments/);
});

test('the heading is the title recorded by fetch', () => {
  const dir = makeRun(tempDir(), 'home-design-critique');
  writeFileSync(join(dir, 'title.txt'), 'Checkout   Flow\n');
  const result = run(script, [dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(dir, 'home-design-critique.md'), 'utf8'), /^# Checkout Flow\n/);
});

test('a run folder without title.txt keeps the "Design critique" heading', () => {
  const dir = makeRun(tempDir(), 'home-design-critique');
  const result = run(script, [dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(dir, 'home-design-critique.md'), 'utf8'), /^# Design critique\n/);
});
