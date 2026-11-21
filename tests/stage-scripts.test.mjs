import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyStage } from '../scripts/stage-scripts.mjs';

const temps = [];
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const scripts = ['_1-fetch-figma-comments.mjs', '_2-generate-design-critique.mjs', '_3-push-figma-comments.mjs'];

for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
  test(`staging ${target} requires all scripts and only its production runtime`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'stage-test-'));
    temps.push(dir);
    mkdirSync(join(dir, 'node_modules', 'sharp'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', '@img', `sharp-${target}`), { recursive: true });
    for (const script of scripts) writeFileSync(join(dir, script), '');
    assert.deepEqual(verifyStage(dir, target).problems, []);

    for (const script of scripts) {
      unlinkSync(join(dir, script));
      assert.ok(verifyStage(dir, target).problems.includes(`${script} is missing`));
      writeFileSync(join(dir, script), '');
    }
    mkdirSync(join(dir, 'node_modules', '@fission-ai'));
    assert.ok(verifyStage(dir, target).problems.some((problem) => problem.includes('development package')));
    mkdirSync(join(dir, 'node_modules', '@img', 'sharp-other-platform'));
    assert.ok(verifyStage(dir, target).problems.some((problem) => problem.includes('another platform')));

    const isolated = join(dir, 'repo');
    const scriptDir = join(isolated, 'scripts');
    mkdirSync(scriptDir, { recursive: true });
    copyFileSync(join(repo, 'scripts', 'stage-scripts.mjs'), join(scriptDir, 'stage-scripts.mjs'));
    for (const script of scripts) copyFileSync(join(repo, script), join(isolated, script));
    writeFileSync(join(isolated, 'package.json'), JSON.stringify({ dependencies: { sharp: '^0.35.5' } }));
    const fakeNpm = join(dir, 'fake-npm.mjs');
    writeFileSync(
      fakeNpm,
      `
import child from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
child.execFileSync = (_command, args, { cwd }) => {
  if (!args.includes('--omit=dev')) throw new Error('development dependencies were not omitted');
  const os = args.find((arg) => arg.startsWith('--os=')).slice(5);
  const cpu = args.find((arg) => arg.startsWith('--cpu=')).slice(6);
  mkdirSync(join(cwd, 'node_modules', 'sharp'), { recursive: true });
  mkdirSync(join(cwd, 'node_modules', '@img', 'sharp-' + os + '-' + cpu), { recursive: true });
};
syncBuiltinESMExports();
`,
    );
    const result = spawnSync(process.execPath, ['--import', fakeNpm, join(scriptDir, 'stage-scripts.mjs'), target], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const staged = join(isolated, 'src-tauri', 'resources', 'scripts');
    for (const script of scripts) {
      assert.equal(readFileSync(join(staged, script), 'utf8'), readFileSync(join(repo, script), 'utf8'));
    }
    const manifest = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.dependencies, { sharp: '^0.35.5' });
    assert.equal(manifest.devDependencies, undefined);
    assert.deepEqual(verifyStage(staged, target).problems, []);
  });
}
