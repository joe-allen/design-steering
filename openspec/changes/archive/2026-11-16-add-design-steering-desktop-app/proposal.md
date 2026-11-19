# Proposal

## Why

The design-critique tooling is two Node scripts driven from a terminal with a `.env` file. That is fine for the author but too much for teammates who only want to pull Figma comments into a readable critique. A desktop app, "Design Steering", lets a small team install it, paste a Figma token and page URL, click one button, and read the result, without a terminal or a repo checkout.

## What Changes

- Add a Tauri 2 desktop app with a Svelte 5 (plain Vite, no SvelteKit) UI, named **Design Steering**, that wraps the existing scripts. The scripts stay the single source of truth for fetching comments, drawing pins and generating markdown.
- Add three screens, following the mockups in `ui-design/`: **Comments** (a "Get comments" action that runs fetch + generate and shows the rendered markdown, with a download button), **History** (searchable list of past runs), and **Settings** (token, page URL, run name, option toggles, Node path).
- Ship installers: macOS `.dmg` (arm64 and x64) and Windows NSIS `-setup.exe`, built in GitHub Actions on a private repo. Builds are unsigned and have no auto-updater.
- Spawn the user's own Node 22.9+ to run the bundled scripts. Node is a documented prerequisite and is not bundled. The app locates Node itself, because GUI apps do not inherit the shell `PATH`.
- Bundle the scripts and a production-only `node_modules` (`sharp`) as app resources, installed per OS and CPU in CI.
- Add small, backwards-compatible options to the scripts so the app can drive them: an output directory option and a machine-readable result line. Token is passed to the child process through the `FIGMA_TOKEN` environment variable.
- Store settings, including the Figma token, in the app's settings file (plain text, as decided). Run output lives in the app-data folder; "Download" copies a run folder to a location the user chooses.
- Move `@fission-ai/openspec` from `dependencies` to `devDependencies` so it is not shipped in the installer.
- Update the README with the Node prerequisite, install steps and the unsigned-app workaround for macOS and Windows.
- Out of scope for now: in-app markdown editing (and the regenerate-over-edits warning it needs), code signing and notarization, auto-update, a configurable runs folder, and a TypeScript port of the script logic.

## Capabilities

### New Capabilities

- `app-packaging`: Building and distributing the app as an unsigned macOS `.dmg` and Windows NSIS installer, including the bundled scripts and production dependencies, the fixed bundle identifier, and the CI build matrix.
- `app-settings`: The Settings screen and its persisted values (Figma token, page URL, run name, images and user toggles, Node path), and how the token is handled.
- `critique-runner`: Locating Node, running the fetch and generate scripts from the app with progress and errors, where runs are written, and the script options that make this possible without changing CLI behavior.
- `critique-viewer`: The Comments, History and download behavior: starting a run, rendering the generated markdown safely, listing and searching past runs, and copying a run to a chosen folder.

### Modified Capabilities

<!-- None: openspec/specs/ is empty. The CLI behavior is unchanged and is covered only where new options are added. -->

## Impact

- **New code:** `src-tauri/` (Rust: commands to detect Node, spawn scripts and stream output, list runs, copy a run), a Svelte/Vite frontend, `tauri.conf.json`, and a GitHub Actions release workflow.
- **Changed code:** `_1-fetch-figma-comments.mjs` and `_2-generate-design-critique.mjs` gain an output-directory option and a machine-readable result; `package.json` moves `@fission-ai/openspec` to `devDependencies` and adds app scripts; `README.md` is extended.
- **Dependencies:** `@tauri-apps/cli`, `@tauri-apps/api`, Tauri store, dialog and fs plugins, Svelte 5, Vite, a markdown renderer, and DOMPurify. `sharp` remains the only runtime dependency of the scripts.
- **Security:** generated markdown contains raw HTML and untrusted Figma comment text, so the preview must sanitize it and run under a strict CSP. The token is stored in plain text and must never be written to logs or run folders.
- **Operational:** a GitHub repo is needed for CI. The bundle identifier fixes the app-data path and cannot be changed after installs without orphaning user data.
