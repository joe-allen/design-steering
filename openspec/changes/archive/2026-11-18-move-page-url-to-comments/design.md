# Design

## Context

Today `pageUrl` and `runName` are two of six keys in `settings.json`, edited on the Settings screen. `getComments()` in `src/lib/session.svelte.js` loads all settings, checks the token and URL, and passes the whole object to the Rust `start_run` command, whose `RunSettings` struct holds all of them. The Comments screen already has the new toolbar markup and CSS from the working tree (`Sync comments`, `Download markdown`, a `New page` button that does nothing yet), with comments at the two places the form belongs. A run folder holds the comments JSON, `_frames/` and the markdown, and History lists a folder as complete when `<folder>.md` exists. The scripts and CLI are not part of this change (see proposal.md - What Changes).

## Goals / Non-Goals

**Goals:**

- Make "which page, what name" an input of each run rather than a saved preference.
- Let "Sync comments" fetch the right page for any displayed run, including ones opened from History.
- Make deleting a run complete: removing a run, or all runs, leaves nothing of them behind in the app's data (the app's top priority is user privacy).

**Non-Goals:**

- A list or history of page URLs, or editing the page of an existing run.
- Changes to the scripts, their options, or the installers.
- Persisting the run name between runs.
- Compatibility with settings files or run folders from earlier builds: the app has no existing users, so nothing is migrated and no fallbacks are kept for them.
- Removing copies the user downloaded to other folders, or secure-erase (overwriting disk blocks) of deleted files.

## Decisions

### 1. Page URL and run name become per-run inputs; Rust keeps one struct

The frontend builds the run inputs as `{ ...settings, pageUrl, runName }` and `start_run` keeps taking a single `RunSettings` object, so `execute_run`, token handling, redaction and validation in `runner.rs` are untouched. Rust still validates a non-empty token and URL, so the "required values" rule does not rely on the UI alone.

*Alternative:* split Rust into `Settings` and `RunRequest` structs. Rejected: it renames fields through the runner and its tests for no behavior change.

### 2. The settings module is split into Settings keys and the remembered page

`loadSettings`/`saveSettings` handle only `token`, `images`, `user` and `nodePath`, and `saveSettings` writes only those keys, so saving Settings can never overwrite the remembered page. New `loadLastPage()`/`rememberPage(url)`/`forgetPage()` read, write and delete the `pageUrl` key. The key keeps its name because it already exists in the settings file; nothing else is carried over, and a leftover `runName` key is not read.

The URL is remembered when a run is started from the form, not when it succeeds, so a failed attempt does not lose what the user typed. Sync never changes it.

*Alternative:* keep `pageUrl` in `DEFAULT_SETTINGS` and just hide the field. Rejected: Settings' save would then rewrite it from a stale copy, which is the failure the spec scenario "Saving keeps the remembered page" guards against.

### 3. Each run records its source in `source.json`

After the fetch succeeds and the run folder is validated, and before generate runs, Rust writes `source.json` into the run folder as `{ "pageUrl": "...", "runName": "..." }`, using the values the run started with (run name as typed, trimmed). The scripts are not involved, so the CLI keeps its behavior and the Figma scripts stay the single source for fetching.

- The file name does not match the generate script's `-figma-comments` pattern, so it cannot be mistaken for the comments JSON.
- A write failure fails the run. The folder has no markdown yet, so it never reaches History.
- It holds no token. The URL is not secret, and downloaded folders carry the file along.
- Completion is still "the markdown exists"; the record is not part of that test.

*Alternative:* have the fetch script write it, since it already holds the URL. Rejected: it adds a script option and output file to the CLI contract for an app-only need.

*Alternative:* derive the page from the comments JSON `link` field. Rejected: it has the file key and a frame node, not the page URL the user entered, and the fetch needs a page or top-level frame node.

### 3a. Reading a run returns its source

`read_run` returns, besides the markdown and folder path, `source` (the parsed record, or `null` when the file is missing or malformed). A missing or malformed record does not stop the run from opening, for example if someone edited the folder by hand; it only disables Sync for that run.

### 4. Sync resolves its inputs from the displayed run

`syncRun(run)` in the session module uses `run.source` (page URL and run name). When `source` is null it starts nothing and tells the user to use "New page".

It then goes through the same run path as "Get comments" and does not call `rememberPage`. Because the run path is shared, progress, the single-run guard, errors and token redaction behave identically.

### 5. Comments screen state lives in the session store

Switching to History and back destroys the screen component, so the form draft and the "New page" mode are kept in `session` (`draft: { pageUrl, runName }`, `newPage: boolean`), with the existing `run`, `running` and `error`. The draft's URL is filled from `loadLastPage()` once at app start.

- Form is shown when `run` is null or `newPage` is true. The toolbar is shown otherwise.
- "New page" sets `newPage` and clears the draft run name but keeps the URL pre-filled. The "Back to Comments" control appears only when there is a run to go back to. The inactive top-right "New page" label shown in `get-new-comments.png` is not rendered; it was dropped in `7e5a88e`.
- `newPage` is cleared when a run succeeds or a run is opened from History. A failed run leaves it, and the draft, in place.
- The missing-URL message is a field-level error next to the input (`session.urlError`). The token message keeps using the banner with its "Open Settings" action, which is shown only for the token error; other errors no longer offer it.

*Alternative:* keep the draft in the component and accept losing it on navigation. Rejected: it would drop a half-typed URL when the user peeks at History.

### 6. Deleting runs: whole folders, validated names, no leftovers

Rust gets `delete_run(id)` and `delete_all_runs()` in `runs.rs`.

- `delete_run` reuses `resolve_run` (name regex, real direct child of the runs folder, symlinks pointing outside rejected) and then removes the folder recursively. Nothing else in the app writes per-run data: the source record, JSON, images and markdown all live in that folder, so removing the folder removes everything. The app keeps no run index or cache, and deletion does not move anything to a trash.
- A name that resolves to anything other than a real folder directly inside the runs folder (a symlink, for example) is rejected with an error and nothing is deleted. Symlinks cannot be created by the app, and delete-all leaves such entries alone like any other non-run entry.
- `delete_all_runs` removes every entry in the runs folder that matches the run-folder name pattern, including folders from failed runs that History does not list, then returns. If some folders fail, it still deletes the rest and returns an error that names those left behind. The frontend then forgets the remembered page URL (`forgetPage()`) only when everything was deleted. Entries that are not run folders are left alone.
- Both commands refuse to run while a run is in progress, using the same single-run flag as `start_run`, because the folder being written must not be removed. The frontend also disables the buttons.
- History shows a remove action on each entry and a "Remove all" action, each behind a confirmation. The confirmation is a small in-app prompt rather than a native dialog, so it needs no extra plugin permission, and it states that the run and its images are permanently deleted. After a deletion the list is reloaded from the backend, so the UI shows what is on disk. If the displayed run was deleted, `session.run` is cleared so Comments shows the form.

*Alternative:* move runs to the system trash. Rejected: it leaves the data on disk, which contradicts the privacy requirement.

*Alternative:* overwrite files before deleting. Rejected as a non-goal: it is unreliable on modern file systems and goes beyond the stated need.

### 7. Tests and docs follow each piece

Rust: record written and read, absent and malformed record, write failure, deleting one run, deleting all (including an incomplete run), refusing bad names and symlinks out, partial failure, refusal during a run. Vitest: the settings split (save does not clobber the page), Settings screen without the two fields, Comments flows for the form, New page and Back and Sync, and History removal with confirmation. The README "Use" section and settings table are updated, including that removing a run does not remove downloaded copies.

## Risks / Trade-offs

- [A downloaded run now includes a file with the Figma page URL] → The URL carries a file key and node id, not credentials; the token is never written. Noted in the README.
- [Deleted files may be recoverable from disk by forensic tools] → Out of scope (see Non-Goals). Files are removed from the file system, with no copy kept by the app.
- [Delete-all removing unlisted failed-run folders surprises someone] → They are run leftovers in the app's own folder and may hold comments JSON, so removing them is the privacy-preserving behavior.
- [The working tree has uncommitted UI and CSS edits in the same files] → The work builds on them; commit them first so the feature diff stays reviewable.
- [Run name is no longer persisted, so people must retype it] → Acceptable; a run name is per-run by nature, and Sync reuses the recorded one.

## Migration Plan

None: the app has no existing users, so there are no settings or run folders from earlier builds to carry over. To roll back, revert the change.
