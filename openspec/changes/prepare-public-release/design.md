# Design

## Context

See proposal.md (Why) for the motivation. Current state that shapes the approach:

- `.github/workflows/release.yml` builds on a pushed `v*` tag with `tauri-apps/tauri-action`. Its three-target matrix (macOS arm64, macOS x64 cross-built on the arm64 runner, Windows x64) runs `check:config`, the tests, `stage-scripts.mjs` and `check-artifacts.mjs`. `tests/release.test.mjs` parses this file. It has never run, and the project has no Git remote.
- The version `0.1.0` is typed by hand in `tauri.conf.json` and `Cargo.toml`; `package.json` has none.
- There is no formatter, linter or `svelte-check`. rustfmt would change 4 Rust files. The production build warns about two unused CSS selectors and a missing Svelte config.
- Main previously broke because a `style:` commit changed behavior. With commit-driven versioning, the commit type decides whether a release happens.
- `core:default` already grants `core:app:allow-version`, and Tauri v2 accepts a path to `package.json` as the app version.
- The owner's account is on GitHub Pro, so rulesets apply to the private repository. Actions minutes are metered on private repositories, and macOS minutes cost the most.

## Goals / Non-Goals

**Goals:**

- Every check a pull request must pass is a named job that a ruleset can require.
- The installer built for a pull request and the one built for a release come from the same workflow definition.
- No path publishes a release with missing installers.
- Nothing compiles the app on Linux. Platform-independent checks may use an Ubuntu runner.

**Non-Goals:**

- Running macOS builds or macOS-only Rust tests on every pull request (see Risks).
- Requiring branches to be up to date before merging, or CI on pushes to `main`.
- Changing app or script behavior beyond showing the version.

## Decisions

### 1. Fresh history in the same folder, old `.git` moved aside

The steps:

- Archive `move-page-url-to-comments`.
- Move the two `crit-2026-11-13-*` folders out of the project folder.
- Move the existing `.git` folder to a backup location outside the project. This is reversible and keeps reflogs and stashes.
- Run `git init -b main` and set the repository's `user.email` to the GitHub noreply address.
- Audit, then create one root commit: `feat: Design Steering desktop app and command-line scripts`. The audit reviews the staged file list for `.env`, run folders and `.DS_Store`, and searches the staged content for the real Figma file key and any `figd_` value other than the known test placeholders.

The root commit's type is `feat`, so release-please derives the first release from it.

*Alternatives:* `git filter-repo` keeps the 9 commits, but its safety depends on listing every bad path and on cleaning reflogs and backups. Nothing was ever pushed, so that history has little value. An orphan branch inside the old `.git` keeps the old history next to the new one, where a single `git push --all` would publish it.

### 2. One formatting and lint setup for JavaScript, Svelte and Rust

- **Prettier**, with `prettier-plugin-svelte`. Settings: `singleQuote: true` and `printWidth: 120`, which matches most hand-written JavaScript in `scripts/`, `tests/` and the root scripts. `.prettierignore` excludes:
  - build output (`dist`, `src-tauri/target`, `src-tauri/gen`, `src-tauri/resources/scripts`)
  - `package-lock.json`
  - `CHANGELOG.md`, which release-please owns
  - `openspec/` and `.agents/`, which OpenSpec manages; reformatting them would churn archived artifacts
  - `ui-design/`
- **ESLint** flat config: `@eslint/js` recommended, `eslint-plugin-svelte` recommended plus its `prettier` preset (so the two tools don't disagree), browser globals for `src/`, and Node globals for `scripts/`, `tests/`, the root `.mjs` scripts and config files.
- **`svelte-check --fail-on-warnings`**, with a minimal `svelte.config.js` (which also removes the build warning). There is no `jsconfig` or `checkJs`; type-checking plain JavaScript is out of scope. The two unused selectors (`.nav-item svg`, `.ghost`) are dead CSS and get removed, so the check starts clean.
- **Rust:** rustfmt defaults, and `cargo clippy --all-targets -- -D warnings`.
- **npm scripts:** `format`, `format:check` (Prettier and `cargo fmt --check`), `lint`, `check`, `lint:rust`, `check:version`. The existing `test` script is unchanged.

The bulk reformat happens once, before the root commit, so no formatting-only commit or blame-ignore file is needed.

### 3. Pre-commit hook: simple-git-hooks and lint-staged

`prepare: simple-git-hooks` installs a pre-commit hook that runs lint-staged:

| Files | Commands |
| --- | --- |
| `*.{js,mjs,svelte}` | `eslint --fix`, then `prettier --write` |
| `*.{css,json,md,yml,yaml,html}` | `prettier --write` |
| `*.rs` | `rustfmt --edition 2021` |

lint-staged works only on the staged content and restores unstaged edits afterwards, which meets "files not part of the commit are not changed". Tests and clippy stay in CI so commits stay fast. `--no-verify` remains possible; CI is the real gate.

*Alternatives:* husky adds a hook directory and boilerplate for the same result. lefthook adds a binary dependency.

### 4. Squash merges with checked titles

The title check uses `amannn/action-semantic-pull-request`, configured with the types and scopes from the spec and an optional scope. It runs on `opened`, `edited`, `synchronize` and `reopened`, so fixing a title re-runs it.

Repository settings:

- Only squash merges are allowed.
- The squash commit title is the pull request title, and the commit message is blank.
- Branches are deleted after merging.

The blank body keeps stray conventional-looking lines out of the changelog. It also means a `BREAKING CHANGE:` footer is lost, so breaking changes use `!` in the title, as the pull request template and README explain.

The ruleset on `main`:

- Pull requests are required, with 0 approvals because there is a single maintainer.
- The status checks below are required.
- Force pushes and deletion are blocked.
- There are no bypass actors.

### 5. release-please, manifest mode

`release-please-config.json`:

- One package `.` with `release-type: node` and `include-component-in-tag: false`, so tags look like `v0.1.0`.
- `bump-minor-pre-major: true`.
- `draft: true` and `force-tag-creation: true`. A draft release normally has no tag until it is published; forcing the tag lets release-please find the previous release.
- `pull-request-title-pattern: "chore(release): release ${version}"`. Its `release` scope passes the title check, and `chore` keeps it out of the changelog.
- `changelog-sections`: Features, Bug Fixes, Performance and Reverts are shown; docs, style, refactor, test, build, ci and chore are hidden. Breaking changes get their own section automatically.
- `extra-files`: TOML updaters for `src-tauri/Cargo.toml` (`$.package.version`) and `src-tauri/Cargo.lock` (`$.package[?(@.name==='design-steering')].version`).

`.release-please-manifest.json` starts as `{".": "0.0.0"}`, and `package.json` and `Cargo.toml` start at `0.0.0`. The `feat` root commit then makes the first release PR propose 0.1.0. Builds made before the first release honestly report 0.0.0.

Release notes come from the release PR's description, while `CHANGELOG.md` comes from the PR's branch. The README tells the maintainer to edit both, after the last change for that release has merged, because release-please rewrites its PR whenever releasable changes land.

*Alternatives:* semantic-release publishes on every merge, with no review step and a slow 3-platform build each time. Tagging by hand with git-cliff needs a hand-written bump script and leaves room for mistakes.

### 6. A GitHub App token for release-please

Pull requests and tags created with `GITHUB_TOKEN` do not trigger other workflows. A release PR opened that way would never run CI, so the required checks would block it. The owner creates a GitHub App:

- Permissions: Contents, Pull requests and Issues set to read and write. release-please uses the Issues API for its labels.
- Installed only on this repository.
- Its ID is stored in the repository variable `RELEASE_APP_ID`, and its private key in the secret `RELEASE_APP_PRIVATE_KEY`.

`actions/create-github-app-token` mints a short-lived token for the release-please step only. The installer builds and the publish step use `GITHUB_TOKEN` with `contents: write`, because they run in the same workflow run.

*Alternative:* a fine-grained PAT is simpler, but it expires and acts as the owner. The owner chose the App.

### 7. Workflow layout

```
ci.yml        (pull_request)
  PR title ............ semantic title check
  Checks .............. ubuntu: format:check, lint, check, test:scripts, test:app,
                        check:config, check:version   (no app compilation)
  Windows installer ... uses build.yml  platforms=windows

build.yml     (workflow_call + workflow_dispatch: platforms windows|macos|all, tag?)
  per target: npm ci -> check:config -> check-version [tag] -> clippy (host targets)
              -> test:rust (not macOS x64) -> stage -> tauri-action build
              -> check-artifacts (kind + version)
              -> tag ? attach to the draft release : upload-artifact (7 days)

release.yml   (push to main; concurrency: one release at a time)
  release-please (App token) --release_created--> build.yml platforms=all tag=vX.Y.Z
                                                   --> publish: verify assets -> undraft
```

- The required checks are **PR title**, **Checks** and **Windows installer**.
- `workflow_dispatch` on `build.yml` is how macOS installers are built on request for any branch.
- In release mode, tauri-action gets `tagName` with `releaseDraft: true`. That is the same draft-release mechanism the current workflow uses, so it attaches files to the draft release-please created. If it cannot find that draft, the fallback is `gh release upload <tag>`.
- The publish job reads the draft's assets. It requires exactly one `aarch64` `.dmg`, one `x64` `.dmg` and one `-setup.exe`, and no `.msi`, `.AppImage`, `.deb` or `.rpm`. Only then does it run `gh release edit <tag> --draft=false --latest`. If any build fails, `publish` never runs and the draft stays unpublished.

### 8. Version consistency check

`scripts/check-version.mjs` exports a function and also works as a command-line tool, like `check-artifacts.mjs`. It checks that:

- `tauri.conf.json` `version` is `../package.json`,
- `package.json`, `Cargo.toml` and the `design-steering` entry in `Cargo.lock` have the same version,
- if a tag argument is given, it equals `v<version>`.

A failure names each file and the version it holds. `check-artifacts.mjs` gains an optional version that every installer file name must contain. The release build runs the tag check before compiling, so a mismatch fails early. Installer names come from the Tauri version, so they match by construction; the artifact check guards against mistakes in that path.

### 9. Version on the Settings screen

`src/lib/api.js` gains `appVersion()`, a thin wrapper over `getVersion()` from `@tauri-apps/api/app`, so tests can mock it like the other API calls. Settings shows "Version X.Y.Z" as a muted line at the bottom of the form, and shows nothing if the call fails. No capability change is needed.

*Alternative:* inject the version from `package.json` at build time with Vite `define`. Rejected because it reports the source tree's version rather than the running binary's.

### 10. Small supporting changes

- `.gitignore` adds `/*-design-critique/` and `/*-design-critique-*/`, which are where the scripts write run folders by default.
- `LICENSE` is MIT, "Copyright (c) 2026 Joe Allen (idea and design) / AI (code)".
- `package.json` `engines` becomes `>=22.12`, because vite and vitest need it. CI uses Node 22. The users' runtime minimum stays 22.9, in the README and in `MIN_VERSION`.
- `.github/pull_request_template.md` reminds contributors of the title format, scopes, `!` for breaking changes, and writing titles for users.
- The README's "Build from source" and "Contributing" sections describe the tools, the hook and the release process. Its install section notes that the Windows installer is built automatically but untested on a Windows PC.

## Risks / Trade-offs

- **The draft-release behavior of release-please (`force-tag-creation`) or tauri-action differs from the docs.** → The first release run is the test. On any failure the release stays a draft, which is safe. The fallback upload is `gh release upload`, and the publish job's asset check stops a partial release.
- **The first release PR proposes something other than 0.1.0.** → Set `release-as: "0.1.0"` in the config for that one PR, then remove it.
- **macOS-only code paths are not tested on pull requests.** These are the Unix-only Rust tests and the login-shell Node lookup. → They run on every release before it is published, and anyone can run a macOS build of a branch from `build.yml`. Developers on macOS also run `npm test` locally.
- **The Windows installer has never been run on a Windows PC.** → It is built and checked on every pull request. The README and the v0.1.0 release notes say it is untested.
- **The bulk reformat could change rendering, for example whitespace inside inline Svelte markup.** → Run the full test suite and look over the app before the root commit.
- **New lint or `svelte-check` findings may need code changes.** → Small, behavior-neutral fixes are in scope. Anything that would change behavior is reported, not silently changed.
- **Two pull requests that each pass could break `main` together**, because branches don't have to be up to date and CI doesn't run on `main`. → Accepted for a single maintainer, to save Actions minutes. The next pull request's checks would catch it.
- **The squash body is blank, so `BREAKING CHANGE:` footers are dropped.** → `!` in the title, as documented in the template and README.
- **The App's private key can leak.** → It is stored only as an Actions secret, and the App is installed on this repository only.

## Migration Plan

1. Archive `move-page-url-to-comments`. Implement the tooling, workflows, version wiring, Settings line and docs in the current folder, and run every check locally.
2. Move the `crit-*` folders and the old `.git` out of the folder, audit, run `git init`, and create the root commit (Decision 1).
3. Owner: create the private repository `joe-allen/design-steering` and the GitHub App; add the variable and the secret; push `main`.
4. The push runs `release.yml`, and release-please opens "chore(release): release 0.1.0". CI runs on it, including the first Windows installer build.
5. Apply the merge settings and the ruleset, now that the check names exist.
6. Edit the release PR's changelog entry and description (summary plus the Windows note), merge it, and watch the draft get its three installers and become published.
7. Archive this change in a follow-up pull request.

**Rollback:** before the push, move the old `.git` back. After the push, the repository is private; delete the draft release and its tag, or the repository.
