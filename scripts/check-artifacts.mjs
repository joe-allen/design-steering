// Checks installers, either those one build job produced or the assets of a draft release.
//   ARTIFACT_PATHS='["…"]' node scripts/check-artifacts.mjs dmg|nsis [version]   one build job's output
//   ARTIFACT_PATHS='["…"]' node scripts/check-artifacts.mjs release [version]    a release's asset names
import assert from 'node:assert/strict';

const EXPECTED = { dmg: /\.dmg$/i, nsis: /-setup\.exe$/i };
const INSTALLER = /\.(dmg|msi)$|-setup\.exe$/i;
const RELEASE_INSTALLERS = {
  'macOS arm64 .dmg': /aarch64.*\.dmg$/i,
  'macOS x64 .dmg': /x64.*\.dmg$/i,
  'Windows -setup.exe': /-setup\.exe$/i,
};
const OTHER_PLATFORMS = /\.(msi|AppImage|deb|rpm)$/i;
const fileName = (path) => path.split(/[\\/]/).pop();

function assertVersioned(paths, version) {
  if (!version) return;
  const exact = new RegExp(`(?<![\\d.])${version.replaceAll('.', '\\.')}(?![\\d.])`);
  const unversioned = paths.filter((path) => INSTALLER.test(path) && !exact.test(fileName(path)));
  assert.deepEqual(unversioned, [], `installer file names must contain ${version}: ${unversioned.join(', ')}`);
}

/** One build job's output: exactly one installer of `kind`, no MSI, and `version` in each installer name. */
export function checkArtifacts(kind, paths, version) {
  assert.ok(EXPECTED[kind], `unknown bundle kind "${kind}"`);
  const matching = paths.filter((path) => EXPECTED[kind].test(path));
  assert.equal(
    matching.length,
    1,
    `expected exactly one ${kind} installer, got ${matching.length}: ${paths.join(', ')}`,
  );
  const msi = paths.filter((path) => /\.msi$/i.test(path));
  assert.deepEqual(msi, [], `MSI installers must not be produced: ${msi.join(', ')}`);
  assertVersioned(paths, version);
}

/**
 * A release's assets: exactly one arm64 `.dmg`, one x64 `.dmg` and one `-setup.exe`, no installer
 * for another platform, and `version` in each installer name.
 */
export function checkReleaseAssets(names, version) {
  for (const [label, pattern] of Object.entries(RELEASE_INSTALLERS)) {
    const found = names.filter((name) => pattern.test(name));
    assert.equal(found.length, 1, `expected exactly one ${label}, got ${found.length}: ${names.join(', ')}`);
  }
  const dmgs = names.filter((name) => /\.dmg$/i.test(name));
  assert.equal(dmgs.length, 2, `expected exactly two .dmg files, got ${dmgs.length}: ${dmgs.join(', ')}`);
  const other = names.filter((name) => OTHER_PLATFORMS.test(name));
  assert.deepEqual(other, [], `installers for other platforms must not be attached: ${other.join(', ')}`);
  assertVersioned(names, version);
}

if (process.argv[1]?.endsWith('check-artifacts.mjs')) {
  const [kind, version] = process.argv.slice(2);
  const paths = JSON.parse(process.env.ARTIFACT_PATHS ?? '[]');
  if (kind === 'release') checkReleaseAssets(paths, version);
  else checkArtifacts(kind, paths, version);
  console.log(`Installer check passed for ${kind}${version ? ` ${version}` : ''}.`);
}
