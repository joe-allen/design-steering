# Design

## Context

See [proposal.md](./proposal.md) for the motivation and [the viewer](./specs/critique-viewer/spec.md) and [runner](./specs/critique-runner/spec.md) deltas for behavior.

The fetch script already knows each Figma comment's `id`, `parent_id`, and effective file or branch key, but exports only a display pin number and a link with the ID in its fragment. The generator produces a static Markdown checklist. `Critique.svelte` displays it through `renderCritique`, which sanitizes untrusted text and restricts images to the run. `source.json` records the originating page URL and run name for a later fetch. The Tauri runner launches Node scripts, passing the token in the environment, and the webview's content security policy disallows direct API requests.

Figma's [comments endpoints](https://developers.figma.com/docs/rest-api/comments-endpoints/) accept a root ID to post a reply, or a comment ID to post a reaction. They do not update a comment's text or resolve a thread.

## Goals / Non-Goals

**Goals:**

- Bind each action to the original run, file or branch, and root comment, independently of any text or links in the critique.
- Preserve the fetched snapshot and the existing renderer and layout behavior. Keep the token and local action data outside exports and logs.
- Use one push worker per confirmed batch, with durable per-action outcomes and no automatic replay of ambiguous writes.

**Non-Goals:**

- No full round-trip synchronization, editing the fetched JSON in place, or new API client in the webview.
- No migration of old runs into writable runs by parsing links, and no new public CLI commands, package dependencies, or credentials.

## Decisions

### 1. Add identity to new snapshots without replacing the format

Keep the array and existing fields in `*-figma-comments*.json`. Add `id`, `parent_id` (normalized to `null` for roots), and `file_key` (the effective key used in the fetch request, including a branch key). Derive `has_done_reaction` from Figma's reaction array using the `:white_check_mark:` shortcode. Keep the display `reactions` string for existing consumers. A done-mark is taken only from the thread root; `resolved_at` remains independent.

Group identity-aware rows by root ID within each frame when generating Markdown. Put the root's pin number in a Figma link, keep a single checkbox for the root, and indent the replies without extra checkboxes. Keep existing titles, image matching, General comments handling, and author/resolve presentation. The generator still accepts legacy snapshots, with its existing item-by-item fallback rather than inferring a parent from a pin number or timestamp.

### 2. Use app-owned thread controls, not clickable Markdown as authority

Follow the [annotated Comments mockup](../../../ui-design/_3-push-figma-comments--new-ui.png): open in locked preview and put the controls on each thread when unlocked, not in a separate picker. Render the interactive thread rows from validated snapshot records, preserving frame grouping, nested replies, pin links, resolved labels and both layouts. Bind each row to the run and its root ID, never to its position, displayed pin number or an ID parsed from rendered Markdown. Keep the sanitized read-only fallback for legacy runs. Do not make the critique `contenteditable` or alter the saved Markdown.

Reply opens an inline text field beneath the selected thread. Treat a nonblank draft as one local outbox action; update that action as its text changes. The root checkbox queues or cancels an unsent done-mark; a posted check mark is read-only. Expose delivery status and recovery at the affected thread. Keep local drafts across layout and lock changes. Finish pending local saves before locking or opening review so neither a last keystroke nor a failed save can be mistaken for a reviewed update.

In locked mode show **Sync comments**. In unlocked mode show Sync until there are eligible updates, then replace it with **Save 1 update** or **Save N updates**. Count eligible replies and done-marks, not edited threads or keystrokes. Save opens the review; only **Send to Figma** confirms it. Locking does not dispatch anything. Sync remains pull-only and downloads still contain the original fetched snapshot.

Use the existing session and Tauri API layer to scope state to the displayed run. An outbox failure leaves the read-only preview usable with an explicit error. The review shows the destination, exact reply text or done mark, and the saved-token identity notice. Confirmation carries the run ID and reviewed outbox revision; if either changes, reload the review instead of sending a different batch.

### 3. Keep the outbox beside the snapshot and exclude it from exports

Use a versioned `outbox.json` in the app-managed run folder, created only when needed. Each action has a local ID, root ID, kind, reply text where relevant, and delivery status; outcomes may store the returned Figma reply ID and time. Replace the file atomically using a temporary sibling so an interruption does not replace the only valid copy with a partial write. A missing outbox means no local actions; a malformed or unsupported outbox is an error, not an empty queue. Keep only one pending done-mark per root.

Reuse `runs.rs` for run lookup; write commands resolve only completed app runs, reject symlinks for write targets, and validate referenced IDs against the fetched rows. Reuse the runner's idle guard to serialize queue edits, pushes, fetches, and run removals. During delivery, the push worker owns status writes; when it exits, reload the outbox for the same run. Deleting the run still removes the whole folder. Adjust download copying to allow only the existing shareable snapshot files: generated Markdown, comments JSON, frame PNGs, `title.txt`, and `source.json` when present. This also excludes any temporary outbox files.

Storing actions inside the comments JSON would make downloaded snapshots contain draft content and blur the distinction between local actions and Figma data. A separate global queue would require new ownership and cleanup rules.

The in-process idle guard does not coordinate separate app instances. Use an OS-backed exclusive lock on a stable app-data file outside the removable run folders, so deleting a run cannot replace the lock being held by another instance. Serialize outbox mutations, push dispatch, and run removals through it. Acquire the lock before validating the reviewed revision and keep the batch exclusive until the worker has stopped dispatching and checkpointing, including when its parent exits. If the lock is held, report that another instance is busy and leave the queue unchanged. After an interruption, the next holder must treat any persisted in-flight action as uncertain, not as eligible to resend. The lock file stores no run or action data and is never exported.

### 4. Launch a bounded push worker through the existing runner

Add a bundled `_3-push-figma-comments.mjs` with no dependency beyond Node. Launch it through Tauri with the existing Node discovery and token redaction. Process arguments identify the resolved run, not the token or reply text. The worker reads the confirmed outbox and checks that the snapshot key matches the key parsed from the recorded Figma source. Use the same file/branch parsing rules as fetch and require a recognized Figma origin for writes. Send only to the fixed Figma API origin, with path parameters encoded and redirects disabled for write requests.

Before any POST, read the current file comments once to confirm root IDs and skip done-marks already present there. Post replies to `/v1/files/:key/comments` with `message` and the root `comment_id`; do not provide a new pin location. Accept a reply as confirmed only if the response identifies the expected parent and a new comment ID. Post done-marks to `/v1/files/:key/comments/:root_id/reactions` with `:white_check_mark:`. Report failures with status and a useful explanation, not raw Figma responses or reply bodies. A missing or rejected token points to Settings; a `403` can also mean the token or account lacks access to the file, so don't assert that scope is always the cause.

Persist in-flight status before each POST and the result immediately afterward. Continue independent work after a definite action-specific rejection, but stop the batch on a transport interruption, ambiguous response, or batch-wide failure such as denied access. Leave actions that were never attempted queued. A saved in-flight state without a result is "needs verification," not "failed"; recovery offers an Open in Figma link and an explicit acknowledgement before moving that action back to the queue. Never replay a POST in the worker, even after a timeout. Keep the worker bound to the runner so loss of the parent prevents further dispatch.

Immediate posting or broadening the webview's network permission would remove the explicit review boundary. Using one worker and the existing runner avoids a separate browser or native HTTP stack.

## Risks / Trade-offs

- **Response lost after Figma accepted a reply** -> There is no documented idempotency key. A durable per-action checkpoint and manual verification avoid silently posting duplicates; an incorrect manual retry can still duplicate a reply.
- **Changes since the last fetch** -> The preflight detects a removed root or an existing check mark, but it is not a lock in Figma. Handle subsequent API rejection without retargeting the action.
- **The opened run is older than Figma** -> Local outcomes are displayed separately from the snapshot. Sync creates a fresh run; it never sends or migrates pending actions. Reopen the original run for unfinished work.
- **Installing a build without the push script** -> Extend `stage-scripts.mjs` alongside the existing macOS and Windows checks. Keep release changes and this change's resource manifest in agreement if `prepare-public-release` lands first.

## Migration Plan

No background migration. Existing runs continue to display, download, and sync as before; a successful fresh fetch produces write-capable metadata. Keep Settings and token storage unchanged. Reverting the app does not undo actions already posted in Figma. Run deletion still purges local data, including the outbox; copies already shared remain unchanged.
