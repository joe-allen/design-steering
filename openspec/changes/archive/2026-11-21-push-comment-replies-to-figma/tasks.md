# Tasks

## 1. Snapshot and generated critique

- [x] 1.1 Add effective file/branch key, comment and parent IDs, and check-mark detection to the fetch output. Extend the stub and fetch tests to prove that a root and its reply retain distinct IDs and the same pin number, that the branch key is preserved, and that the old JSON fields remain available.
- [x] 1.2 Generate one linked checklist item per root with nested replies and the fetched done status. Extend generation tests for rendered thread shape, resolved versus done, old JSON, no images, and the existing display title and author option.
- [x] 1.3 Document the new snapshot fields and thread checklist in the README's Output section; verify its examples and field names against generated test fixtures.

## 2. Run-local outbox and export boundary

- [x] 2.1 Expose validated thread metadata for completed runs while retaining the read-only preview for legacy or invalid write metadata. Add Rust tests for incomplete runs, wrong destinations, non-root targets, and symlink rejection.
- [x] 2.2 Add versioned outbox storage and queue/edit/discard commands with atomic saves, review revisions, and one pending done-mark per root. Add Rust tests for persistence, duplicate marks, stale review revisions, and rejecting a malformed outbox without overwriting it.
- [x] 2.4 Add the stable app-data lock and require it for queue mutations and run removals. Test from separate processes that contention leaves the queue and run intact and that the lock can be acquired after its holder exits.
- [x] 2.3 Limit run downloads to shareable snapshot files and retain whole-folder deletion. Extend `runs.rs` tests to prove that downloads preserve the source record, title, relative images, and non-overwrite suffix behavior but omit pending, posted, and temporary outbox data; verify single-run and all-run removal clear the outbox.

## 3. Figma delivery

- [x] 3.1 Add the Node push worker with destination and root preflight, one POST per eligible action, and a skip for already-marked roots. Use a request-recording stub to verify the exact branch and root IDs, reply and reaction payloads, and absence of writes for missing roots, mismatched source records, or stale reviews.
- [x] 3.2 Checkpoint before and after each request and stop on ambiguous or batch-wide errors. Cover success followed by definite rejection, 403, 429, response loss, checkpoint failure, and interrupted delivery in worker tests; assert that confirmed actions are not resent and unattempted actions remain queued.
- [x] 3.3 Add the Tauri push command using the existing Node discovery, idle guard, and progress channel. Hold the cross-process lock through review validation and until the worker stops dispatching and checkpointing, even if its parent exits. Test that competing processes cannot send the same reviewed reply and that an interrupted in-flight reply requires verification. Retain tests for busy-state exclusion, environment-only token handling, and error output without tokens or reply text.

## 4. Comments review and recovery

- [x] 4.1 Add run-scoped thread actions and a review for the pending batch. Extend Comments/session tests for queueing, editing, discarding, reacting once per thread, confirming the exact batch, cancellation, and showing no push action for an empty queue. Verify a forged Markdown link or checkbox cannot queue or dispatch anything.
- [x] 4.2 Present confirmed, rejected, and uncertain results, with a Settings link for token errors and explicit verification before retrying an uncertain action. Test reload from History, partial success, and Sync leaving the earlier run intact with no automatic writes or refresh after push.
- [x] 4.3 Document the queue, explicit push, `file_comments:write` and saved account, manual verification, and snapshot-only download. Check the README walkthrough against the tested UI labels and the read-only token flow.

## 5. Packaging and integration

- [x] 5.1 Stage the new push script with the existing runtime resources, preserving development and installed script discovery. Verify the staging checks require all three scripts for macOS arm64, macOS x64, and Windows x64, with no added development dependencies in the bundle.
- [x] 5.2 Run `npm test` and `npm run check:config`. Exercise fetch, queue, push, manual sync, download, and deletion end-to-end using stubbed Figma responses; verify that no real Figma file is modified by the tests.

## 6. Inline editing in the critique

- [x] 6.1 Replace the separate thread picker with locked preview and inline thread controls in both layouts. Bind each row to its validated root ID, keep posted text and legacy snapshots read-only, and test that duplicate pin labels or Markdown lookalikes cannot select a destination.
- [x] 6.2 Open the reply editor under its thread and persist nonblank drafts and pending Done marks in the run's outbox. Test revising or discarding a draft, undoing an unsent mark, changing layouts, and relocking without losing or sending work. Surface local save failures without discarding the user's text.
- [x] 6.3 Replace Sync with "Save 1 update" or "Save N updates" only while unlocked with eligible actions. Review the latest draft text before "Send to Figma"; retain cancellation, per-thread delivery status, and explicit recovery after uncertain delivery. Test the count, final keystroke, relock/Sync, and the absence of writes before confirmation.
- [x] 6.4 Update the README walkthrough to match the inline flow. Verify it against the mockup in both layouts and run the Comments/session tests and the stubbed end-to-end flow without contacting Figma.
