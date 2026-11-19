# Design

## Context

The repo is two dependency-light Node scripts, `_1-fetch-figma-comments.mjs` and `_2-generate-design-critique.mjs`, that write run folders next to themselves. The fetch script reads `FIGMA_TOKEN` from the environment, prints progress to stderr and a single `Wrote ...` line to stdout, and needs `sharp` only for pin drawing. The generate script finds the newest run folder under its own directory and requires a `_frames/` folder. The scripts stay the source of truth (see proposal.md - What Changes); the app is a shell around them.

Constraints that shape the approach:

- GUI apps on macOS do not inherit the shell `PATH`, and on Windows an app keeps the `PATH` it was launched with, so Node must be located explicitly on every run.
- Generated markdown contains raw HTML and untrusted Figma comment text.
- The Figma token is stored in plain text by decision, so the rest of the system must not leak it.
- Installers are unsigned, there is no auto-update, and Node is not bundled.

## Goals / Non-Goals

**Goals:**

- Change the scripts as little as possible, and only in backwards-compatible ways.
- Keep all privileged work (spawning processes, touching the file system) in a small set of Rust commands with validated inputs, and keep the webview unprivileged.
- Build all three installers from one workflow, including the correct `sharp` native binaries per target.

**Non-Goals:**

- Sharing code between the app and the scripts beyond running them as child processes.
- Cancelling a run in progress. The spec only requires disabling a second run.
- Any network access from the webview.

## Decisions

### 1. Layout: scripts stay at the repo root, the app wraps them

The `.mjs` files stay where they are and keep working from the CLI. The app adds `src/` (Svelte), `src-tauri/` (Rust) and a staging step that copies the scripts into `src-tauri/resources/scripts/` for bundling. Staging output is git-ignored.

*Alternative:* move the scripts into `src-tauri/`. Rejected: it breaks the existing `npm run critique` workflow and the README for no gain.

### 2. Script additions: `--out`, `--print-run-dir`, optional `_frames`

- Both scripts accept `--out=<dir>`. It replaces `root` as the folder that holds run folders. Without it, `root` is used, so CLI behavior is unchanged. The fetch script creates the folder if it is missing.
- The fetch script accepts `--print-run-dir`. It then prints the absolute run folder path as its last stdout line. The existing `Wrote ...` line is kept, and the path line is printed after it.
- The generate script treats a missing `_frames/` as "no images", so every comment lands under "General comments".
- The app always passes the run folder explicitly to the generate script, so it never depends on "newest folder" detection.

*Alternative:* parse the `Wrote <path> (...)` log line. Rejected: fragile, and the path may contain spaces and parentheses.

### 3. Settings are owned by the frontend and passed to Rust per run

The frontend reads and writes `settings.json` through the Tauri store plugin in the app-data folder. `start_run` receives the settings as its argument. Rust re-validates that token and URL are non-empty, so the "required values" rule does not depend on the UI alone. Rust never writes the token anywhere.

The token is passed only as the `FIGMA_TOKEN` environment variable of the child process. The page URL is passed as an argument, because it is not secret. `FIGMA_PAGE_URL` and `FIGMA_TOKEN` are cleared from the inherited environment first so a stray value in the user's environment cannot win.

*Alternative:* Rust reads the store itself. Rejected as more code for no behavioral difference.

### 4. Node discovery runs on every run, in a fixed order

`detect_node` tries candidates in this order and checks each with `<candidate> --version`, which must be 22.9 or later:

1. The Node path from Settings.
2. macOS: the login shell, run as `$SHELL -l -i -c 'command -v node'` with a short timeout, because version managers such as fnm and nvm are often configured in interactive rc files.
3. Standard locations. macOS: `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `~/.volta/bin/node`, `~/.nvm/versions/node/*/bin/node` (newest). Windows: `%ProgramFiles%\nodejs\node.exe`, `%ProgramFiles(x86)%\nodejs\node.exe`, `%LOCALAPPDATA%\Programs\nodejs\node.exe`, `%LOCALAPPDATA%\Volta\bin\node.exe`, and `%ProgramFiles%\nodejs` under the nvm-windows symlink (`%NVM_SYMLINK%`).

The first candidate that passes is used. If none passes, the error reports the version of the first candidate that ran at all ("found 20.11.0"), or says none was found. Nothing is cached, so installing Node after launch works without a restart. An explicit path that fails is an error. It does not silently fall through to auto-discovery.

*Alternative:* read the Windows registry for the current machine `PATH`. Rejected for now: standard locations cover the official installer, Volta and nvm-windows. Revisit if teammates report misses.

### 5. Running the scripts: Rust child processes streaming over a Tauri channel

`start_run` runs fetch, reads the run folder path from the last stdout line, then runs generate with that folder. Each child's stdout and stderr lines are sent to the frontend over a Tauri `Channel`. Every line has the token string replaced with `***` before it is sent, as a second line of defence behind the scripts never printing it.

- A process-wide `AtomicBool` guard rejects a second concurrent `start_run`. The frontend also disables the button.
- On Windows the child is created with `CREATE_NO_WINDOW`.
- Script paths are the resolved resource directory, with any `\\?\` prefix removed, because Node mishandles it.
- On a non-zero exit, the error returned is the last stderr lines of that script. When fetch fails, generate does not run.

### 6. Runs, history and "completed"

Runs live in `<app-data>/runs/`, where the scripts' own naming and no-overwrite rules apply (`--out` points there). A run is "completed" if its folder contains `<folder-name>.md`. This makes fetch-only or generate-failed folders invisible to History with no extra state. History reads the folder names, derives the run name by stripping `-design-critique(-N)?`, and takes the date from the markdown file's modified time. The list is sorted newest first, and search filters client-side on the displayed date string and name, case-insensitively.

Commands that take a run take only the folder name, and Rust checks it against `^[A-Za-z0-9-]+-design-critique(-\d+)?$` and that it is a direct child of the runs folder. This rules out path traversal.

### 7. Rendering untrusted markdown

Rust `read_run` returns the markdown text. The frontend renders it with `marked`, then sanitizes with DOMPurify before inserting into the DOM:

- A fixed allow-list of tags (headings, paragraphs, lists, checkbox inputs, `a`, `img`, inline formatting). `script`, `style`, `iframe`, forms, event-handler attributes, and the `style` attribute are all removed.
- A DOMPurify hook keeps an `<img>` only if its `src` is a relative `_frames/<file>.png` path, and rewrites it to the run's file via `convertFileSrc`. Any other `src`, including `http(s):`, `data:` and absolute paths, removes the element. The sizing the script writes in `style` is replaced by a CSS rule on the preview.
- A click handler on the preview prevents default navigation. External `http(s)` links open through the opener plugin, limited to `https`/`http`. The `<a>` that wraps each frame image does nothing.

The backstop is the CSP in `tauri.conf.json`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' asset: http://asset.localhost; connect-src ipc: http://ipc.localhost`. There is no remote origin anywhere, so even a sanitizer bug cannot load remote content. The asset protocol scope is limited to `$APPDATA/runs/**`, and the capabilities file grants only what the UI uses: the store, the dialog `open` and the scoped opener.

*Alternative:* inline images as `data:` URLs in Rust. Rejected: 2x frame PNGs are large and would pass through IPC and sit in the DOM. It would also need `data:` in the CSP.

### 8. Download is one Rust command, not the fs plugin

The dialog plugin picks a destination folder. A `copy_run(run_name, dest)` command then copies the validated run folder recursively into `dest/<run_name>`. It picks the next free `-N` suffix if that name exists, and never writes into an existing folder. This keeps the webview free of general file-system access. It also drops the fs plugin from the proposal's dependency list.

### 9. Bundling and per-target native dependencies

A staging script builds `src-tauri/resources/scripts/` with the two `.mjs` files, a `package.json` that lists only `sharp`, and a `node_modules` from `npm install --omit=dev --os=<os> --cpu=<cpu>`. OpenSpec is therefore never in the bundle, and it also moves to `devDependencies` in the root `package.json`. The staging script takes the target platform from the build target (`darwin`/`arm64`, `darwin`/`x64`, `win32`/`x64`), so the right `@img/sharp-*` packages are installed even when cross-building. The staged tree is checked after install. If binaries for any other platform are present, or the target's are missing, the build fails.

`tauri.conf.json` fixes the identifier `com.designsteering.desktop`. Bundle targets are `dmg` and `nsis` only. The NSIS WebView2 mode is `downloadBootstrapper`, which installs the runtime when missing.

### 10. CI: one workflow, three targets

A workflow triggered by `v*` tags uses a matrix with `aarch64-apple-darwin` and `x86_64-apple-darwin` on a macOS runner, and `x86_64-pc-windows-msvc` on `windows-latest`. It runs staging for the target, then `tauri-apps/tauri-action`, which attaches the artifacts to a draft release. The x64 macOS build is cross-built from the arm64 runner, which is why native binaries are chosen by the `--os/--cpu` staging step. It does not depend on the runner's own architecture.

### 11. Frontend shape

Svelte 5 (runes) on plain Vite. There is no router. A single `screen` state switches between Comments, History and Settings, and a `currentRun` state holds the run on display. History selection sets `currentRun` and switches to Comments. The mockups in `ui-design/` drive the visual layout.

## Risks / Trade-offs

- [Login-shell lookup is slow or hangs on a heavy `.zshrc`] → Short timeout, then fall through to standard locations.
- [A Node install outside the known locations is missed on Windows] → The Settings Node path is the escape hatch, and the error message points to it.
- [Cross-building x64 macOS from arm64 ships the wrong `sharp` binary] → The staged-tree check fails the build if the target's binaries are absent or another platform's are present. The release checklist includes one run of the x64 build on an Intel Mac or under Rosetta.
- [Plain-text token on disk] → Accepted by decision. Mitigated by the child-env-only handoff, log redaction, the "clear token" action, and nothing writing it into run folders.
- [A sanitizer bug lets hostile markup through] → The strict CSP has no remote origin and no inline script, and the webview has no file-system or shell capability. The impact is limited to broken rendering.
- [Unsigned builds are blocked by Gatekeeper and SmartScreen] → Documented in the README as required by the spec.
- [Changing the bundle identifier orphans user data] → The identifier is fixed in `tauri.conf.json` and covered by a check in the CI workflow.
- [Run folders accumulate] → No cleanup in this change. Runs are small and the configurable runs folder is out of scope.

## Migration Plan

Nothing migrates, because the app is new and the CLI is unchanged. To roll back, stop publishing releases. The CLI scripts keep working throughout. The `@fission-ai/openspec` move to `devDependencies` only affects production installs, and `npm install` still installs it for development.

## Open Questions

- Whether the unsigned macOS build needs a README step for `xattr -cr` on Apple Silicon, in addition to right-click Open. This is settled when the arm64 build is first tried on a teammate's Mac, and it only affects README wording.
