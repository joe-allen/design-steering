// Checks that every version source agrees, and optionally that a release tag matches them.
//   node scripts/check-version.mjs [vX.Y.Z]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FILES = {
  package: 'package.json',
  tauri: 'src-tauri/tauri.conf.json',
  cargoToml: 'src-tauri/Cargo.toml',
  cargoLock: 'src-tauri/Cargo.lock',
};
const TAURI_VERSION = '../package.json';

export function readVersionFiles(root = ROOT) {
  return Object.fromEntries(Object.entries(FILES).map(([key, path]) => [key, readFileSync(join(root, path), 'utf8')]));
}

function cargoTomlVersion(text) {
  const table = /^\[package\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? '';
  return /^version\s*=\s*"([^"]*)"/m.exec(table)?.[1];
}

function cargoLockVersion(text) {
  return /^\[\[package\]\]\r?\nname = "design-steering"\r?\nversion = "([^"]*)"/m.exec(text)?.[1];
}

/**
 * Throws an Error naming each file and the version it holds when `package.json`, `Cargo.toml` and the
 * `design-steering` entry of `Cargo.lock` disagree, when `tauri.conf.json` does not take its version
 * from `package.json`, or when `tag` is given and is not `v<version>`. Returns the version.
 */
export function checkVersion(files, tag) {
  const versions = {
    [FILES.package]: JSON.parse(files.package).version,
    [FILES.cargoToml]: cargoTomlVersion(files.cargoToml),
    [FILES.cargoLock]: cargoLockVersion(files.cargoLock),
  };
  const problems = [];
  const tauriVersion = JSON.parse(files.tauri).version;
  if (tauriVersion !== TAURI_VERSION) {
    problems.push(`${FILES.tauri} has version ${JSON.stringify(tauriVersion)}; it must be "${TAURI_VERSION}".`);
  }
  const listed = Object.entries(versions).map(([file, version]) => `${file} ${version ?? '(no version found)'}`);
  if (Object.values(versions).some((version) => !version) || new Set(Object.values(versions)).size > 1) {
    problems.push(`Versions disagree: ${listed.join(', ')}.`);
  }
  const version = versions[FILES.package];
  if (tag !== undefined && tag !== `v${version}`) {
    problems.push(`Tag ${tag} does not match ${FILES.package} ${version} (expected v${version}).`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return version;
}

if (process.argv[1]?.endsWith('check-version.mjs')) {
  try {
    const version = checkVersion(readVersionFiles(), process.argv[2]);
    console.log(`Version check passed: ${version}${process.argv[2] ? ` matches ${process.argv[2]}` : ''}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
