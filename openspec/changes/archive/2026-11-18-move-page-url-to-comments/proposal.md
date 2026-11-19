# Proposal

## Why

The Figma page URL and run name change from run to run, but they live in Settings next to values that are set once (token, toggles, Node path). To fetch a different page the user has to leave Comments, edit Settings, save, and come back. The updated mockups (`ui-design/5.png`, `ui-design/get-new-comments.png`) put the page input on the Comments screen instead, with "Sync comments", "Download markdown" and "New page" actions on a displayed critique.

## What Changes

- Move the **Figma Page URL** and **Run name (optional)** inputs from Settings to the Comments screen. Settings keeps the token, the images and author toggles, and the Node path.
- Comments shows an input form (page URL, run name, "Get comments") when no critique is displayed, and when the user clicks **New page**. The form from "New page" has a "Back to Comments" control that returns to the critique that was displayed.
- With a critique displayed, the toolbar offers **Sync comments**, **Download markdown** and **New page**, matching `ui-design/5.png`.
- **Sync comments** fetches the page the displayed run came from. To make that possible for runs opened from History, each run records its source page URL and run name when it is created.
- Remember the last page URL entered so the form is pre-filled with it. It is kept in the settings file under the `pageUrl` key. The run name is not remembered.
- A missing page URL is reported on the Comments screen. A missing token still points to Settings.
- **History can remove runs.** Each entry can be removed individually, and all runs can be removed at once, each after a confirmation. Removing a run deletes its whole folder, including `source.json`, comments JSON, frame images and markdown, and leaves nothing of it in the app's data folder. "Remove all" also forgets the remembered page URL. User privacy is the priority for this app.

Out of scope: changing how the scripts fetch or generate, a list of saved pages, editing the URL of an existing run, anything about the token, toggles or Node path, removing copies the user downloaded elsewhere, and support for run folders or settings files from earlier builds (the app has no existing users, so nothing is migrated).

## Capabilities

### New Capabilities

<!-- None: the work belongs to existing capabilities. -->

### Modified Capabilities

- `app-settings`: Settings no longer has the page URL and run name fields; persistence, "required values" and "settings map to script options" requirements are rewritten accordingly.
- `critique-viewer`: the Comments screen gains the page input form, the New page and Back to Comments flow, and the Sync comments, Download markdown and New page toolbar; the empty-state requirement changes; History gains removing one run or all runs.
- `critique-runner`: each run records its source page URL and run name, a run takes its page URL and run name as inputs of the run instead of from saved settings, and a run can be deleted completely.

## Impact

- **Frontend:** `src/screens/Comments.svelte` (form, toolbar, new-page flow), `src/screens/Settings.svelte` (remove two fields), `src/screens/History.svelte` (remove one, remove all, confirmations), `src/lib/session.svelte.js` (run inputs, sync source, missing-URL message, clearing a deleted open run), `src/lib/settings.js` (stop treating the page URL and run name as Settings fields; remember last-used URL), `src/lib/api.js`. Existing tests for Settings, Comments, History and the settings store change.
- **Backend (Rust):** `src-tauri/src/runner.rs` writes the run's source record after a successful fetch; `src-tauri/src/runs.rs` returns it when a run is read and deletes runs; `src-tauri/src/lib.rs` registers the new delete commands.
- **Run folders:** gain one small JSON file with the page URL and run name. It never contains the token. The scripts do not read it, and the folder is still self-contained when downloaded. Deleting a run removes the whole folder.
- **Docs:** the README "Use" section and settings table, including that removing a run does not remove copies the user downloaded.
- **Compatibility:** no script, CLI or installer changes. There are no existing users, so no migration or support for earlier run folders is kept. The existing uncommitted CSS and markup edits in `src/` are the starting point for the UI work and are not reverted.
