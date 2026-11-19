# Tasks

## 1. Script options

- [x] 1.1 Add `--out=<dir>` and `--print-run-dir` to `_1-fetch-figma-comments.mjs` (default folder unchanged, run folder path printed as the last stdout line), add node:test cases in `tests/fetch-options.test.mjs` for the default location, `--out` and the last stdout line using a stubbed Figma API, and verify `npm run test:scripts` passes
- [x] 1.2 Add `--out=<dir>` to `_2-generate-design-critique.mjs`, make a missing `_frames/` list every comment under "General comments", repair its garbled header comment, add node:test cases in `tests/generate-options.test.mjs` for `--out`, the newest-run lookup and a run with no `_frames/`, and verify `npm run test:scripts` passes
- [x] 1.3 Verify the CLI is unchanged by running `npm run generate` with no new options against `crit-2026-11-13-design-critique/` and confirming the output markdown is identical to the committed one

## 2. App scaffold

- [x] 2.1 Move `@fission-ai/openspec` to `devDependencies`, add Svelte 5, Vite, `@tauri-apps/cli`, `@tauri-apps/api`, `marked` and `dompurify`, add `dev`, `build` and `tauri` scripts, and verify `npm install` succeeds and `npm ls --omit=dev` lists only `sharp` and the frontend packages
- [x] 2.2 Scaffold `src-tauri/` with Tauri 2 (identifier `com.designsteering.desktop`, product name "Design Steering", bundle targets `dmg` and `nsis`, WebView2 `downloadBootstrapper`) and the store, dialog and opener plugins, and verify `npm run tauri dev` opens an empty window
- [x] 2.3 Add the strict CSP, the asset protocol scope limited to `$APPDATA/runs/**` and a minimal capabilities file (store, dialog open, opener limited to http/https), and verify with `npm run check:config` that the config has no remote origin and no `unsafe-inline` script source
- [x] 2.4 Build the shell: sidebar with Comments, History and Settings, active-item marking and Comments shown on launch, following `ui-design/`, with a component test (vitest) that checks the launch screen and switching screens

## 3. Settings

- [x] 3.1 Implement the settings store (token, page URL, run name, images default on, author default off, Node path) with load and save over the store plugin, and verify a vitest case for first-launch defaults and a save-then-reload round trip
- [x] 3.2 Build the Settings screen: masked token field with a clear action, text fields, two toggles, a Node path field with a Detect action, and a save confirmation or error message, and verify the screen shows the spec's first-launch defaults and clearing the token removes it from the store (vitest)

## 4. Runner (Rust)

- [x] 4.1 Implement `detect_node` (settings path, then macOS login shell with a timeout, then standard locations for macOS and Windows, version check of 22.9 or later, nothing cached) and verify Rust unit tests cover version parsing, explicit-path-wins, "too old" reporting the found version, and "none found"
- [x] 4.2 Stage the bundled scripts: write `scripts/stage-scripts.mjs` that copies both `.mjs` files into `src-tauri/resources/scripts/`, writes a `package.json` listing only `sharp`, installs with `--omit=dev --os --cpu` for a given target, and fails if the wrong platform's `@img/sharp-*` is present or the right one is missing, and verify it for `darwin/arm64`, `darwin/x64` and `win32/x64` and that `openspec` is absent from the result
- [x] 4.3 Implement `start_run` (validate token and URL, fetch then generate on the printed run folder, token only in the child environment, `--out` set to `<app-data>/runs`, `--images` and `--user` from settings, single-run guard, `CREATE_NO_WINDOW` and `\\?\` prefix removal on Windows, token redacted from streamed lines) with a Rust unit test for redaction and the single-run guard, and verify an integration test using a stub script shows fetch failure skips generate and that a second concurrent start is rejected
- [x] 4.4 Implement the run-folder commands (`list_runs`, `read_run`, `copy_run`) with the folder-name validation regex and direct-child check, and verify Rust tests cover completed-run detection (needs `<folder>.md`), name and date derivation, rejection of `..` and absolute paths, and `copy_run` using the next free `-N` without touching an existing folder

## 5. Comments and History screens

- [x] 5.1 Build the safe markdown renderer (marked, then DOMPurify with the tag allow-list, no `style` or event attributes, `<img>` kept only for relative `_frames/*.png` and rewritten with `convertFileSrc`, link click handling with external links through the opener), and verify vitest cases for a script tag, an event handler attribute, a remote image (removed) and a normal frame image and `[Resolved]` line (kept)
- [x] 5.2 Build the Comments screen: empty state with "Get comments", missing-value and Node-requirement messages, live log pane from the run channel, button disabled while running, rendered critique with scrolling and a download button wired to the dialog and `copy_run` (cancel is silent), and verify with a vitest component test using mocked commands that each state renders as specified
- [x] 5.3 Build the History screen: newest-first list of runs by date and name, no-runs and no-matches messages, case-insensitive search on date and name, and opening a run into Comments with download available, and verify vitest cases for ordering, filter "check" over "checkout" and "home", and the empty states

## 6. Packaging and CI

- [x] 6.1 Add the release workflow (`v*` tags, matrix `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`, staging for each target, `tauri-apps/tauri-action` attaching to a draft release) with a step that fails when the bundle identifier is not `com.designsteering.desktop`, and verify it with `actionlint` and a check that the matrix produces two `.dmg` files and one `-setup.exe` and no `.msi`
- [x] 6.2 Run a local `npm run tauri build` for the host platform and verify the installer opens, a run with a real token and page URL writes a run folder in app data, and the bundled `node_modules` contains `sharp` and not `@fission-ai/openspec`

## 7. Documentation

- [x] 7.1 Update `README.md` with the Node 22.9 or later prerequisite and how to check it, install steps for the `.dmg` and the Windows installer, the unsigned-app steps for macOS (right-click Open or `xattr -cr`) and Windows ("More info", then "Run anyway"), and the Settings fields, and verify each documented command runs as written

## 8. Integration checks

- [x] 8.1 Walk the spec scenarios end to end in the built app (first-launch defaults, missing token, Node missing or too old, successful run, fetch failure showing no History entry, images off, author on, repeat run naming, download with name clash, hostile comment text, upgrade-in-place keeping settings and history) and record the result of each in the PR description
