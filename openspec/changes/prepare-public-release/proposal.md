# Proposal

## Why

Design Steering exists only as a local repository. Its release workflow has never run, so the Windows installer has never been built. Main has had failing tests that nothing caught, and the history contains customer design data. Before the first tagged release, the project needs a clean history, a release process driven by conventional commits and semantic versioning, quality checks on every change, and a Windows build that is checked continuously, not only at release time.

## What Changes

- **Clean starting history.** The project moves to a new repository whose history begins with a single commit containing no run output or customer data. Run folders are git-ignored so they cannot be committed again. The repository gets an MIT license. It is published privately first, at `joe-allen/design-steering`; switching it to public later is the owner's decision and is not part of this change.
- **Pull requests with conventional titles.** Changes reach `main` only through squash-merged pull requests. The pull request title becomes the commit and must follow the Conventional Commits format, with scopes that match the app's capabilities. A branch ruleset requires the checks to pass before merging.
- **Automated semantic releases.** release-please keeps a release pull request open that bumps the version and updates `CHANGELOG.md` from merged pull request titles. Merging it creates a draft GitHub release and its tag. The macOS arm64, macOS x64 and Windows installers are then built and attached, and the release is published only when all three succeed. The first release is v0.1.0. Before 1.0, a breaking change bumps the minor version. **BREAKING** (for maintainers only): a pushed `v*` tag no longer triggers a build.
- **One version.** `package.json` is the single source of the version. The Tauri app reads it, release-please keeps `Cargo.toml` and `Cargo.lock` in step, and a check fails the build if the versions disagree with each other or with the release tag.
- **Quality checks on every pull request.** Formatting (Prettier, rustfmt), linting (ESLint with the Svelte plugin, clippy treating warnings as errors), `svelte-check`, the script, app and Rust tests, and the existing configuration and installer checks. A pre-commit hook formats and lints staged files locally.
- **Windows installer on every pull request.** Each pull request builds and checks the Windows `-setup.exe` and makes it downloadable. macOS installers are built for releases and on manual request, which keeps the private repository's Actions usage down.
- **App version in Settings.** The Settings screen shows the installed app's version, so bug reports can say which build they came from.
- **Documentation.** The README covers the contribution and release process. The development Node minimum becomes 22.12 (the build tools need it); the minimum for users stays 22.9. It also notes that the Windows installer has not yet been tested on a Windows PC.

Out of scope: Linux installers or any Linux build of the app, code signing and notarization, auto-update, switching the repository to public, Dependabot and CodeQL, pinned toolchains, testing the scripts on Node 22.9 in CI, an app log file, the dev-dependency security advisories, and type-checking plain JavaScript.

## Capabilities

### New Capabilities

- `release-process`: How changes reach the main branch and become releases: the pull request title format, version numbers derived from merged changes, the release pull request, the changelog and release notes, the checks a change must pass, the local pre-commit check, and keeping run output and customer data out of the repository.

### Modified Capabilities

- `app-packaging`: Installers are built when a release is created through the release process, not when a tag is pushed. A release is published only with its complete set of installers. Every artifact carries the same version as the release. The Windows installer is also built for every pull request.
- `app-settings`: The Settings screen shows the app's version.

## Impact

- **New files:** `.github/workflows/ci.yml`, `.github/workflows/build.yml` (shared installer build), `release-please-config.json`, `.release-please-manifest.json`, `.github/pull_request_template.md`, Prettier, ESLint and Svelte configs, `LICENSE`, `scripts/check-version.mjs`. `CHANGELOG.md` is created by the first release pull request.
- **Changed files:** `.github/workflows/release.yml` (now release-please, then the installer builds, then publish), `package.json` (version, scripts, dev tools, `engines`), `src-tauri/tauri.conf.json` (reads the version from `package.json`), `src-tauri/Cargo.toml`, `.gitignore`, `tests/release.test.mjs`, `src/screens/Settings.svelte` and its test, `src/lib/api.js`, and the README. Every source file is reformatted once by Prettier and rustfmt, before the first commit of the new history.
- **New dev dependencies:** prettier, prettier-plugin-svelte, eslint, @eslint/js, eslint-plugin-svelte, globals, svelte-check, simple-git-hooks, lint-staged.
- **GitHub setup (owner steps):** a new private repository, a GitHub App that release-please uses to open pull requests and create releases (stored as a repository variable and secret), merge settings (squash only, pull request title as the commit message), and a ruleset on `main`.
- **Local data:** the two `crit-2026-11-13-*` folders move out of the project folder. The old `.git` folder is kept as a backup outside the project and is never pushed.
- **Unchanged:** the scripts' command-line behavior, app behavior apart from the version line, the bundle identifier, and the installer formats.
