// Prepares src-tauri/resources/scripts/ for bundling: the two scripts plus a production-only
// node_modules holding `sharp` built for the target platform.
//
//   node scripts/stage-scripts.mjs [<os>-<cpu>]     e.g. darwin-arm64, darwin-x64, win32-x64
//
// Defaults to the host. Cross-staging works because npm picks sharp's native packages from the
// --os/--cpu flags instead of the machine running the install.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'];
const SCRIPTS = ['_1-fetch-figma-comments.mjs', '_2-generate-design-critique.mjs'];

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const stageDir = join(repo, 'src-tauri', 'resources', 'scripts');

const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
if (!TARGETS.includes(target)) {
  console.error(`Unsupported target "${target}". Use one of: ${TARGETS.join(', ')}`);
  process.exit(1);
}
const [os, cpu] = target.split('-');

// Keeps .gitkeep so the resource folder always exists for `tauri dev`.
mkdirSync(stageDir, { recursive: true });
for (const entry of readdirSync(stageDir)) {
  if (entry !== '.gitkeep') rmSync(join(stageDir, entry), { recursive: true, force: true });
}

for (const script of SCRIPTS) copyFileSync(join(repo, script), join(stageDir, script));

const rootPackage = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
writeFileSync(
  join(stageDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'design-steering-scripts',
      private: true,
      type: 'module',
      dependencies: { sharp: rootPackage.dependencies.sharp },
    },
    null,
    2,
  )}\n`,
);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(
  npm,
  ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${os}`, `--cpu=${cpu}`],
  {
    cwd: stageDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

// The scripts never run bin shims, and symlinks are awkward to bundle.
rmSync(join(stageDir, 'node_modules', '.bin'), { recursive: true, force: true });

function verify() {
  const modules = join(stageDir, 'node_modules');
  const problems = [];
  const top = readdirSync(modules).filter((name) => !name.startsWith('.'));
  if (!top.includes('sharp')) problems.push('sharp is missing');
  for (const name of top) {
    if (/openspec|fission-ai|tauri|svelte|vite/.test(name)) problems.push(`development package bundled: ${name}`);
  }

  const imgDir = join(modules, '@img');
  const native = existsSync(imgDir) ? readdirSync(imgDir).filter((name) => name.startsWith('sharp-')) : [];
  if (!native.includes(`sharp-${target}`)) problems.push(`@img/sharp-${target} is missing`);
  for (const name of native) {
    if (!name.endsWith(`-${target}`)) problems.push(`binaries for another platform: @img/${name}`);
  }
  if (problems.length) {
    console.error(`Staged scripts for ${target} are wrong:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`Staged scripts for ${target}: ${native.map((name) => `@img/${name}`).join(', ')}`);
}

verify();
