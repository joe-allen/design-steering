# Tasks

## 1. Prerequisites

- [x] 1.1 Archive `move-page-url-to-comments` with `openspec archive`, and verify that `openspec list` shows only this change as active and `openspec validate --specs --strict --no-interactive` passes

## 2. Repository hygiene

- [x] 2.1 Add `/*-design-critique/` and `/*-design-critique-*/` to `.gitignore`. Verify: create a dummy `x-design-critique/` and `x-design-critique-1/` in the project root, `git status --porcelain` does not list them, then delete the dummies
- [x] 2.2 Add `LICENSE` (MIT, "Copyright (c) 2026 Joe Allen (idea and design) / AI (code)") and a License section in the README. Verify the file holds the standard MIT text and the README names the license

## 3. Formatting, linting and Svelte checks

- [x] 3.1 Add the dev dependencies prettier, prettier-plugin-svelte, eslint, @eslint/js, eslint-plugin-svelte, globals and svelte-check. Add the configs from design Decision 2 (`.prettierrc.json`, `.prettierignore`, `eslint.config.js`, `svelte.config.js`) and the npm scripts `format`, `format:check`, `lint`, `check` and `lint:rust`. Verify `npm install` succeeds and each script runs and reports its findings
- [x] 3.2 Run `npm run format` on the whole tree (Prettier and `cargo fmt`). Verify that `npm run format:check` passes, `npm test` and `npm run build` still pass, and that in `npm run tauri dev` the Comments form, a rendered critique, History and Settings look the same as before
- [x] 3.3 Fix the ESLint, `svelte-check` and clippy findings without changing behavior, including removing the unused `.nav-item svg` and `.ghost` selectors. Verify that `npm run lint`, `npm run check` (zero warnings) and `npm run lint:rust` pass, and that `npm run build` prints no unused-selector or Svelte-config warning. Stop and report any finding whose fix would change behavior
- [x] 3.4 Add the pre-commit hook (simple-git-hooks plus lint-staged, installed by a `prepare` script, with the file rules from design Decision 3). Verify on a scratch branch:
  - a staged Svelte file with formatting differences is committed formatted
  - a staged JS file using an undefined variable stops the commit and shows the error
  - an unstaged edit in another file is left untouched

  Then delete the scratch branch

- [x] 3.5 Set `engines.node` to `>=22.12` and update the README:
  - "Build from source" and "Contributing" list Node 22.12+ for development and the `format`, `lint`, `check` and `lint:rust` commands, and explain the pre-commit hook
  - the install section still says Node 22.9+ for users

  Verify each documented command runs as written

## 4. Version wiring

- [x] 4.1 Set the `package.json` version to `0.0.0`, set `src-tauri/Cargo.toml` to `0.0.0` (letting cargo update `Cargo.lock`), and set `tauri.conf.json` `version` to `"../package.json"`. Verify that `npm run test:rust` and `npm run check:config` pass and that `Cargo.lock` lists `design-steering` at `0.0.0`
- [x] 4.2 Add `scripts/check-version.mjs` (exported function plus command-line use, with an optional `vX.Y.Z` tag argument) and the `check:version` script, per design Decision 8. Verify with tests in `tests/release.test.mjs` that matching versions pass, and that each of these fails naming the file and version involved: a `Cargo.toml` mismatch, a `Cargo.lock` mismatch, a `tauri.conf.json` version that does not point to `package.json`, and a tag that does not match
- [x] 4.3 Give `checkArtifacts` an optional version that every installer file name must contain. Verify with tests that names containing the version pass and a name without it fails, and that the existing kind and MSI tests still pass

## 5. App version in Settings

- [x] 5.1 Add `appVersion()` to `src/lib/api.js` (wrapping `getVersion()` from `@tauri-apps/api/app`), and show "Version X.Y.Z" at the bottom of Settings, showing nothing if the call fails. Update the API mocks in `src/screens/Settings.test.js` and `src/App.test.js`. Verify with vitest that Settings shows "Version 0.1.0" for a mocked 0.1.0 and no version line when the call rejects, and that `npm run check:config` still passes with the capabilities unchanged
- [x] 5.2 Mention the version line in the README's Settings description, as what to include in bug reports, and verify the wording matches the app

## 6. CI and release workflows

- [x] 6.1 Add `release-please-config.json` and `.release-please-manifest.json` (`{".": "0.0.0"}`), as in design Decision 5. Verify that:
  - both files parse and pass release-please's published config schema
  - the `Cargo.toml` JSONPath selects `package.version`
  - the `Cargo.lock` JSONPath selects exactly the `design-steering` entry (checked with jsonpath-plus against the real files)
- [x] 6.2 Add `.github/workflows/build.yml` (`workflow_call` and `workflow_dispatch`, with `platforms` and an optional `tag`), following design Decision 7. Per target it runs: config check, version check (with the tag in release mode), clippy, Rust tests (not on macOS x64), staging, tauri-action, then the artifact check with the version. It uploads 7-day artifacts in pull request mode and attaches to the draft release in release mode. Update `tests/release.test.mjs` to read `build.yml` (bundles dmg, dmg, nsis; `check:config` and `check-version` invoked). Verify with actionlint and `npm run test:scripts`
- [x] 6.3 Add `.github/workflows/ci.yml` with the jobs "PR title", "Checks" (Ubuntu, no app compilation) and "Windows installer" (calls `build.yml` with `platforms: windows`), plus `.github/pull_request_template.md`. Verify with actionlint, and with a test in `tests/release.test.mjs` that the three job names exist and that the title check's types and scopes equal the lists in the release-process spec
- [x] 6.4 Rewrite `.github/workflows/release.yml`: release-please using the GitHub App token, then `build.yml` with `platforms: all` and the tag, then a publish job that checks the draft's assets and undrafts it. Put the asset rule (one aarch64 `.dmg`, one x64 `.dmg`, one `-setup.exe`, no `.msi`/`.AppImage`/`.deb`/`.rpm`) in a tested function in `scripts/check-artifacts.mjs`. Verify with actionlint and with tests that a complete set passes and that missing, duplicate and other-platform files fail
- [x] 6.5 Update the README:
  - replace the "pushing a `v` tag" paragraph with the release process (title format and scopes, `!` for breaking changes, the release pull request, editing its changelog entry and description just before merging, building macOS installers of a branch from the Actions tab)
  - add the note that the Windows installer is untested on a Windows PC

  Verify that the README no longer mentions tag-triggered builds and that every workflow name it cites exists

## 7. Fresh local history

- [x] 7.1 Move the two `crit-2026-11-13-*` folders to a location outside the project that the owner confirms. Verify that no `*-design-critique*` folder remains in the project
- [x] 7.2 Run the full local verification: `npm ci`, `format:check`, `lint`, `check`, `lint:rust`, `npm test`, `check:config`, `check:version`, `npm run build`, then `npm run stage` and `npm run tauri build -- --bundles app`. Verify each passes and that the built app's Settings shows "Version 0.0.0"
- [x] 7.3 Move the existing `.git` folder to a backup location outside the project that the owner confirms, run `git init -b main`, and set the repository's `user.name` to "Joe Allen" and `user.email` to `18443374+joe-allen@users.noreply.github.com`. Verify with `git config --local --list` and that the backup holds the old history (`git --git-dir=<backup> log --oneline` shows the 9 commits)
- [x] 7.4 Stage everything and audit before committing:
  - the staged file list has no `.env`, run folder, `*-figma-comments*.json` or `.DS_Store`
  - the real Figma file key from `.env` appears in no staged file
  - every `figd_` value is a known placeholder or test value

  Then create the root commit `feat: Design Steering desktop app and command-line scripts`. Verify that `git log` shows exactly one commit with the noreply author, and keep the audit output for the owner

## 8. GitHub setup

- [x] 8.1 Create the private repository `joe-allen/design-steering` with `gh repo create --private` without pushing. The owner then creates the GitHub App (Contents, Pull requests and Issues set to read and write), installs it on this repository only, and stores `RELEASE_APP_ID` as a repository variable and the private key as the secret `RELEASE_APP_PRIVATE_KEY`. Verify with `gh repo view` (visibility private), `gh variable list` and `gh secret list`
- [x] 8.2 Push `main`. Verify that the "Release" run succeeds and opens the pull request "chore(release): release 0.1.0" authored by the App, and that "PR title", "Checks" and "Windows installer" run on it and pass
- [x] 8.3 Apply the merge settings through `gh api`: squash only, squash title from the pull request title, blank message, delete branches after merging. Verify by reading the settings back with `gh api repos/joe-allen/design-steering`
- [x] 8.4 Add the `main` ruleset through `gh api`: pull request required with 0 approvals, required checks "PR title", "Checks" and "Windows installer", force pushes and deletion blocked, no bypass actors. Verify that:
  - a direct push of an empty commit to `main` is rejected
  - a throwaway pull request titled "Update readme" fails the title check and cannot be merged
  - retitled "docs: update readme", it passes

  Then close it unmerged and delete its branch

## 9. First release (v0.1.0)

- [x] 9.1 On the release pull request, download the Windows installer artifact. Verify that its file name contains 0.1.0, that no MSI was produced, and that `check:version` passed with every version file at 0.1.0
- [x] 9.2 With the owner, rewrite the 0.1.0 entry in the release branch's `CHANGELOG.md` and in the pull request description: a short summary of what Design Steering does, plus the note that the Windows installer is untested. Verify both texts match
- [x] 9.3 Merge the release pull request. Verify that:
  - the tag `v0.1.0` points at the merge commit
  - the draft release receives the arm64 `.dmg`, x64 `.dmg` and `-setup.exe`
  - the publish job undrafts it, and the published release has exactly those three installers and the edited notes
  - `CHANGELOG.md` on `main` holds the entry
  - `.release-please-manifest.json` says 0.1.0
- [x] 9.4 Install the arm64 `.dmg` from the v0.1.1 release (group 10; v0.1.0's macOS app is reported as damaged) on the owner's Mac, following the README's first-launch steps. Verify that the app opens, Settings shows "Version 0.1.1", and one critique run completes

## 10. macOS downloads open without a "damaged" error (v0.1.1)

- [x] 10.1 Set `bundle.macOS.signingIdentity` to `-` in `src-tauri/tauri.conf.json`, and make `check:config` require it. Verify that `npm run check:config` passes, and that an ad-hoc signed local build's app passes `codesign --verify --deep --strict` with all bundled resources sealed, where the v0.1.0 app fails it
- [x] 10.2 Rewrite the README's macOS first-launch step: "Not Opened", then Done, then Privacy & Security > Open Anyway, with the `xattr` command as the fallback and for v0.1.0. Verify with the owner on macOS 26 that a quarantined copy of the ad-hoc signed `.dmg` shows "Not Opened" and that Open Anyway launches the app
- [x] 10.3 Add the "Check the macOS app signature" step to `.github/workflows/build.yml`, and assert it in `tests/release.test.mjs`. Verify with actionlint and `npm run test:scripts`, and with a dispatched macOS build of the branch in which the step passes for both arm64 and x64
- [x] 10.4 Merge PR #6 (which removes `release-as`), then the fix pull request, then the release pull request proposing 0.1.1. Verify that the v0.1.1 release is published with its three installers, and that the app in its downloaded arm64 `.dmg` passes `codesign --verify --deep --strict`

## Workflow follow-up

- Archive this change in a pull request titled `docs(openspec): archive prepare-public-release`.
- Delete the old `.git` backup and the moved `crit-*` folders when no longer needed.
- Before making the repository public: decide whether pull requests should also build macOS installers, and consider Dependabot, CodeQL and secret scanning.
