# Tasks

## 1. Run source record (Rust)

- [x] 1.1 In `src-tauri/src/runner.rs`, write `source.json` (`pageUrl`, `runName`, no token) into the run folder after a successful fetch and before generate, failing the run if the write fails, and verify with Rust tests that the record holds the URL and trimmed name, an empty name when none was given, never contains the token, and that a write failure returns an error and leaves no markdown
- [x] 1.2 In `src-tauri/src/runs.rs`, return `source` from `read_run_in` (`null` when `source.json` is missing or malformed), and verify with Rust tests for a run with a record, a run without one, a malformed record, and that `list_runs_in` still lists runs with or without a record
- [x] 1.3 In `src-tauri/src/runs.rs`, add `delete_run_in` (reusing `resolve_run`; removes the whole folder; a symlink is removed as a link, never followed) and `delete_all_runs_in` (removes every run-named folder including incomplete ones, continues past failures and returns an error naming the folders left behind, leaves non-run entries alone), register `delete_run` and `delete_all_runs` commands in `src-tauri/src/lib.rs` that refuse while a run is in progress, and verify with Rust tests that a run with images, JSON and `source.json` is gone entirely, other runs and a downloaded-copy folder are untouched, `..`, absolute paths and an outside-pointing symlink delete nothing, an incomplete run folder goes with delete-all, a partial failure still deletes the rest and names the one left, and the commands refuse while the run flag is held
- [x] 1.4 Run `npm run test:rust` and `cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml` and verify both pass

## 2. Settings and session logic (frontend)

- [x] 2.1 Split `src/lib/settings.js` so `loadSettings`/`saveSettings` cover only `token`, `images`, `user` and `nodePath` (saving writes only those keys), and add `loadLastPage()`/`rememberPage(url)`/`forgetPage()` over the `pageUrl` key, and verify with vitest in `src/lib/settings.test.js` that defaults exclude page and run name, that saving Settings leaves a remembered `pageUrl` intact, and that `forgetPage` removes only that key
- [x] 2.2 Rework `src/lib/session.svelte.js`: add `draft` (`pageUrl`, `runName`) and `newPage` to the session and fill the draft URL from `loadLastPage()` at startup; make the run path take `{ pageUrl, runName }`; remember the URL when a run starts from the form; report a missing URL as `urlError` and a missing token as the banner error that points to Settings; clear `newPage` when a run succeeds or a run is opened; leave `newPage` and the draft on failure, and verify with vitest in `src/lib/session.test.js` for each of those behaviors with a mocked API
- [x] 2.3 Add `syncRun(run)` to the session module using the run's recorded source and starting nothing (with a "use New page" message) when there is none, never calling `rememberPage`, and verify with vitest that a sync of page A leaves the remembered URL as page B and that a run without a source starts nothing
- [x] 2.4 Add `removeRun(id)` and `removeAllRuns()` to the session module (call the new API wrappers in `src/lib/api.js`, clear `session.run` when the displayed run is removed, call `forgetPage()` only after delete-all fully succeeds, surface the error naming a run that could not be removed, and do nothing while a run is in progress), and verify with vitest for each of those behaviors with a mocked API

## 3. Settings screen

- [x] 3.1 Remove the Figma Page URL and Run name fields from `src/screens/Settings.svelte` and verify with vitest in `src/screens/Settings.test.js` that they are absent, that first-launch defaults still hold, and that saving after changing a toggle keeps the remembered page URL

## 4. Comments screen

- [x] 4.1 Build the page input form in `src/screens/Comments.svelte` (URL and run name inputs bound to `session.draft`, "Get comments", field-level missing-URL message, progress while running, "Open Settings" action shown only for the token error), shown when there is no run or `newPage` is set, and verify with vitest that the URL input is pre-filled and the run name is empty, a missing URL shows the message next to the input and starts nothing, a missing token shows the Settings pointer, and a successful start passes the entered URL and name
- [x] 4.2 Wire the toolbar from `ui-design/5.png` (replace the TODO comments at the two marked places): "Sync comments" calls `syncRun`, "Download markdown" keeps its behavior, "New page" sets `newPage`; show "Back to Comments" (only when a run exists) and an inactive "New page" label in the form view as in `ui-design/get-new-comments.png`, and verify with vitest that Back returns to the same critique with nothing fetched, a failed new-page run keeps the form and entered values, a successful one replaces the critique, and first launch shows no Back control
- [x] 4.3 Add removal to `src/screens/History.svelte`: a remove action on each entry and a "Remove all" action, each behind an in-app confirmation that says the run and its images are permanently deleted, disabled while a run is in progress, with the list reloaded after deletion and an error shown naming any run that could not be removed, and verify with vitest in `src/screens/History.test.js` for remove one, remove all, cancel, removal while running, an error keeping the run listed, and the empty state after removing everything
- [x] 4.4 Update `src/App.test.js` and `src/screens/Comments.test.js` for the new button labels ("Get comments" in the form, toolbar names), add a Comments test that removing the displayed run from History returns Comments to the form, and run `npm run test:app` and `npm run build`, verifying both pass
- [x] 4.5 Update `src/screens/Comments.test.js` (and `src/App.test.js` if affected) to the UI kept from commit `7e5a88e`: while a run is in progress the loading logo and step message replace the form and toolbar (there is no "Getting comments…" button), and the form opened with "New page" shows only "Back to Comments" (there is no inactive "New page"). Verify with vitest that no "Get comments", "Sync comments" or "New page" action is available during a run and that the "New page" form shows "Back to Comments" without a "New page" action, then run `npm test` and verify all three suites pass
- [x] 4.6 Make the loading logo show and animate in built apps: in `src/components/LoadingLogo.svelte`, replace the nameless `animation` shorthand with `animation-*` longhands, because Vite's production CSS minifier rewrites the shorthand to `animation: none` and the strokes stay hidden. Verify with vitest in `src/components/LoadingLogo.test.js` that the component's CSS still has the 11.2s duration and infinite repeat after minification with Lightning CSS (fails on the previous component), and that the built CSS in `dist/` contains them after `npm run build`

## 5. Documentation

- [x] 5.1 Update the README "Use" section and settings table (page URL and run name now entered on Comments, the toolbar actions, what Sync fetches, `source.json` in run folders, removing runs from History and that downloaded copies are not removed), and verify the table matches the fields shown in the app

## 6. Integration checks

- [x] 6.1 In the built app with a real token, walk the spec scenarios: first launch form, missing URL and missing token messages, New page and Back to Comments, a new-page run replacing the critique, Sync of a run opened from History for a different page, downloading a run that includes `source.json`, removing one run and removing all (confirming the folders and `source.json` are gone from `~/Library/Application Support/com.designsteering.desktop/runs` and that removing the open run returns to the form); record the results in the PR description

## Workflow follow-up

- Commit the existing uncommitted UI and CSS edits in `src/` before starting, so this change's diff stays reviewable.
- Archive the change after review.
