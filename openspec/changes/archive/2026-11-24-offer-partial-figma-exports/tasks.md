# Tasks

## 1. Recover confirmed threads

- [x] 1.1 Add desktop opt-in and status-aware recovery to the fetch worker's page-layer traversal. In the existing fetch stub and script tests, verify that a failed batch can split into a readable sibling and an unreadable branch, that a confirmed ancestor pin survives, and that its replies appear exactly once.
- [x] 1.2 Produce a versioned partial report with known layer paths and IDs, distinguishing unreadable from unexamined branches. Verify duplicate layer names are distinguishable, recovery calls stay within a finite budget, and a fully recovered batch produces no report.
- [x] 1.3 Cover the negative paths in fetch tests: an incomplete scan with no matches, denied access, exhausted rate limit, and a failed page or comments request never produce a saveable candidate. Confirm default CLI exits and `--print-run-dir` behavior remain unchanged.

## 2. Hold the decision and publish safely

- [x] 2.1 Add staged desktop outcomes and local Save/Discard commands in the Tauri runner. Verify a pending run is invisible to History, a second operation is guarded, and saving generates from the staged snapshot without new Figma requests.
- [x] 2.2 Protect candidate finalization and cleanup. Add Rust tests for repeated or stale decisions, invalid IDs, discard, abandoned staging after restart, generation failure and existing folder names. Assert older runs and outboxes are untouched.
- [x] 2.3 Teach Markdown generation and run metadata readers about partial reports. Verify a warning survives regeneration with or without images, untrusted layer names render as text, and complete and legacy runs stay unchanged. Check downloads include the warning but not private staging or outbox data.

## 3. Present the decision and document the gotcha

- [x] 3.1 Wire typed outcomes through the desktop API and session into Comments. Add screen/session tests for Save and Discard after both Get comments and Sync; verify readable counts, layer paths, disabled conflicting actions, and restoration of the prior view.
- [x] 3.2 Mark saved partial runs in History and the critique. Test reopening in both layouts and syncing after repair: only the earlier run retains its warning.
- [x] 3.3 Publish the [FAQ draft](./design.md#faq-draft) in a root `FAQ.md` and link it from README troubleshooting. Verify the link, button labels, non-destructive workaround, and distinction between the observed former-image case and an unconfirmed Figma cause.

## 4. Verify the combined flow

- [x] 4.1 Extend the existing offline runner integration flow with one unreadable branch: discard once, save once, reopen, download, then sync a complete replacement. Verify History and shared Markdown identify only the accepted partial run as partial, and that no Figma writes occur.
- [x] 4.2 Run `npm test` and `openspec validate offer-partial-figma-exports --strict` after integration; confirm the existing fetch, generate, viewer, and push flows still pass.
