// Fails when the Tauri config breaks the security or identity rules from the openspec change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri');
const readJson = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

const conf = readJson('tauri.conf.json');
const capability = readJson('capabilities/default.json');

assert.equal(conf.identifier, 'com.designsteering.desktop', 'bundle identifier must stay fixed');
assert.deepEqual([...conf.bundle.targets].sort(), ['dmg', 'nsis'], 'bundle targets must be dmg and nsis only');

for (const key of ['csp', 'devCsp']) {
  const csp = conf.app.security[key];
  assert.ok(csp, `${key} must be set`);
  assert.match(csp['script-src'], /^'self'$/, `${key}: script-src must be 'self' only`);
  assert.doesNotMatch(csp['default-src'], /unsafe-|https?:|\*/, `${key}: default-src must not allow remote origins`);
  for (const [directive, value] of Object.entries(csp)) {
    const remote = value
      .split(/\s+/)
      .filter(
        (source) => /^(https?|wss?):\/\/(?!localhost|asset\.localhost|ipc\.localhost)/.test(source) || source === '*',
      );
    assert.deepEqual(remote, [], `${key}: ${directive} allows a remote origin`);
  }
}
assert.doesNotMatch(
  conf.app.security.csp['style-src'],
  /unsafe-inline/,
  'production style-src must not allow unsafe-inline',
);

assert.deepEqual(
  conf.app.security.assetProtocol.scope,
  ['$APPDATA/runs/**'],
  'asset protocol must be scoped to the runs folder',
);

const permissions = capability.permissions.map((p) => (typeof p === 'string' ? p : p.identifier));
for (const forbidden of ['fs:', 'shell:', 'http:']) {
  assert.ok(!permissions.some((p) => p.startsWith(forbidden)), `capabilities must not grant ${forbidden}*`);
}

console.log('Tauri config checks passed.');
