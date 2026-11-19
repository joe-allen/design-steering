import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkArtifacts, checkReleaseAssets } from '../scripts/check-artifacts.mjs';
import { checkVersion, readVersionFiles } from '../scripts/check-version.mjs';

function versionFiles({ pkg = '0.1.0', toml = pkg, lock = pkg, tauri = '../package.json', eol = '\n' } = {}) {
  const lines = (...rows) => rows.join(eol);
  return {
    package: JSON.stringify({ name: 'design-steering', version: pkg }),
    tauri: JSON.stringify({ productName: 'Design Steering', version: tauri }),
    cargoToml: lines(
      '[package]',
      'name = "design-steering"',
      `version = "${toml}"`,
      '',
      '[dependencies]',
      'tauri = { version = "2", features = [] }',
      'serde = { version = "9.9.9" }',
      '',
    ),
    cargoLock: lines(
      '[[package]]',
      'name = "design-steering-extra"',
      'version = "9.9.9"',
      '',
      '[[package]]',
      'name = "design-steering"',
      `version = "${lock}"`,
      'dependencies = [',
      ' "tauri",',
      ']',
      '',
    ),
  };
}

test('build workflow produces two dmg and one -setup.exe, and runs the config and version checks', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
  const bundles = [...workflow.matchAll(/"bundle": "(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(bundles.sort(), ['dmg', 'dmg', 'nsis']);
  assert.ok(workflow.includes('npm run check:config'), 'identifier check must run in the build workflow');
  assert.ok(workflow.includes('scripts/check-version.mjs'), 'version check must run in the build workflow');
  assert.match(
    workflow,
    /if: matrix\.platform == 'macos'\n\s+run: \|[\s\S]*?codesign --verify --deep --strict/,
    'macOS builds must verify the app signature',
  );
});

test('CI has the required jobs, and its title check allows exactly the types and scopes in the spec', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const workflow = read('.github/workflows/ci.yml');
  const jobNames = [...workflow.matchAll(/^ {4}name: (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(jobNames.sort(), ['Checks', 'PR title', 'Windows installer']);

  const specPath = [
    'openspec/specs/release-process/spec.md',
    'openspec/changes/prepare-public-release/specs/release-process/spec.md',
  ].find((path) => existsSync(new URL(`../${path}`, import.meta.url)));
  const spec = read(specPath);
  const specList = (pattern) =>
    pattern
      .exec(spec)[1]
      .split(/,\s*|\s+or\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  const workflowList = (key) =>
    new RegExp(`^ +${key}: \\|\\n((?: +\\w+\\n)+)`, 'm')
      .exec(workflow)[1]
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  assert.deepEqual(workflowList('types').sort(), specList(/The type SHALL be one of ([^.]+)\./).sort());
  assert.deepEqual(workflowList('scopes').sort(), specList(/when given, SHALL be one of ([^.]+)\./).sort());
});

test('checkArtifacts accepts one installer of the right kind', () => {
  checkArtifacts('dmg', ['/b/Design Steering_0.1.0_aarch64.dmg', '/b/Design Steering.app.tar.gz']);
  checkArtifacts('nsis', ['/b/Design Steering_0.1.0_x64-setup.exe']);
});

test('checkArtifacts rejects missing, duplicate and MSI installers', () => {
  assert.throws(() => checkArtifacts('dmg', []));
  assert.throws(() => checkArtifacts('dmg', ['a.dmg', 'b.dmg']));
  assert.throws(() => checkArtifacts('nsis', ['x-setup.exe', 'x.msi']));
});

test('checkArtifacts with a version accepts installer names that contain it', () => {
  checkArtifacts('dmg', ['/b/Design Steering_0.1.0_aarch64.dmg', '/b/Design Steering.app.tar.gz'], '0.1.0');
  checkArtifacts('nsis', ['C:\\b\\nsis\\Design Steering_0.1.0_x64-setup.exe'], '0.1.0');
});

test('checkArtifacts with a version rejects an installer name without it', () => {
  assert.throws(() => checkArtifacts('dmg', ['/b/Design Steering_aarch64.dmg'], '0.1.0'), /must contain 0\.1\.0/);
  assert.throws(() => checkArtifacts('nsis', ['/b/Design Steering_0.2.0_x64-setup.exe'], '0.1.0'), /must contain/);
  assert.throws(() => checkArtifacts('dmg', ['/b/Design Steering_10.1.0_x64.dmg'], '0.1.0'), /must contain/);
  assert.throws(() => checkArtifacts('nsis', ['C:\\0.1.0\\Design Steering_x64-setup.exe'], '0.1.0'), /must contain/);
});

const RELEASE_ASSETS = [
  'Design.Steering_0.1.0_aarch64.dmg',
  'Design.Steering_0.1.0_x64.dmg',
  'Design.Steering_0.1.0_x64-setup.exe',
];

test('checkReleaseAssets accepts the complete set of installers', () => {
  checkReleaseAssets(RELEASE_ASSETS, '0.1.0');
  checkReleaseAssets([...RELEASE_ASSETS, 'Design.Steering_0.1.0_aarch64.app.tar.gz']);
});

test('checkReleaseAssets rejects a missing installer', () => {
  for (const missing of RELEASE_ASSETS) {
    assert.throws(() => checkReleaseAssets(RELEASE_ASSETS.filter((name) => name !== missing)), /expected exactly one/);
  }
});

test('checkReleaseAssets rejects a duplicate installer', () => {
  assert.throws(
    () => checkReleaseAssets([...RELEASE_ASSETS, 'Design.Steering_0.1.0_x64-1-setup.exe']),
    /exactly one Windows/,
  );
  assert.throws(
    () => checkReleaseAssets([...RELEASE_ASSETS, 'Design.Steering_0.1.0_universal.dmg']),
    /exactly two \.dmg/,
  );
});

test('checkReleaseAssets rejects installers for other platforms', () => {
  for (const other of [
    'Design.Steering_0.1.0_x64_en-US.msi',
    'Design.Steering_0.1.0_amd64.AppImage',
    'Design.Steering_0.1.0_amd64.deb',
    'Design.Steering-0.1.0-1.x86_64.rpm',
  ]) {
    assert.throws(() => checkReleaseAssets([...RELEASE_ASSETS, other]), /other platforms/);
  }
});

test('checkReleaseAssets rejects installers without the release version', () => {
  assert.throws(() => checkReleaseAssets(RELEASE_ASSETS, '0.2.0'), /must contain 0\.2\.0/);
});

test('checkVersion passes when every version agrees, with or without a matching tag', () => {
  assert.equal(checkVersion(versionFiles()), '0.1.0');
  assert.equal(checkVersion(versionFiles(), 'v0.1.0'), '0.1.0');
  assert.equal(checkVersion(versionFiles({ eol: '\r\n' }), 'v0.1.0'), '0.1.0');
});

test('checkVersion passes for the repository files', () => {
  checkVersion(readVersionFiles());
});

test('checkVersion names the files and versions that disagree', () => {
  assert.throws(
    () => checkVersion(versionFiles({ pkg: '0.2.0', toml: '0.1.0', lock: '0.2.0' })),
    /package\.json 0\.2\.0, src-tauri\/Cargo\.toml 0\.1\.0, src-tauri\/Cargo\.lock 0\.2\.0/,
  );
  assert.throws(
    () => checkVersion(versionFiles({ pkg: '0.2.0', toml: '0.2.0', lock: '0.1.0' })),
    /package\.json 0\.2\.0, src-tauri\/Cargo\.toml 0\.2\.0, src-tauri\/Cargo\.lock 0\.1\.0/,
  );
});

test('checkVersion requires tauri.conf.json to take its version from package.json', () => {
  assert.throws(
    () => checkVersion(versionFiles({ tauri: '0.1.0' })),
    /src-tauri\/tauri\.conf\.json has version "0\.1\.0"/,
  );
});

test('checkVersion rejects a tag that does not match', () => {
  assert.throws(
    () => checkVersion(versionFiles({ pkg: '0.1.0' }), 'v0.2.0'),
    /Tag v0\.2\.0 does not match package\.json 0\.1\.0/,
  );
  assert.throws(() => checkVersion(versionFiles(), '0.1.0'), /Tag 0\.1\.0 does not match/);
});
