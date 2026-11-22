# Proposal

## Why

Design Steering makes it easy to work through Figma feedback, but replying or indicating that feedback is addressed still means switching back to Figma one thread at a time. Let users prepare those follow-ups during a review and decide when to send them.

## What Changes

- Critiques open locked for reading. Unlock to draft a reply directly beneath its thread or queue a done-mark with the thread's checkbox. Posted text stays read-only. Locking again keeps unsent work on the run without posting it.
- While unlocked, **Save N updates** replaces **Sync comments** when there are actions ready to send. It opens a review of the destination and exact updates; only **Send to Figma** posts them.
- Reply to the original thread and mark it done with a check-mark reaction on its root comment. Anyone's check-mark reaction counts as done; a done-mark is not Figma's native resolved status. Remove posted reactions in Figma, not in the app.
- Store drafts and delivery results in a private, per-run outbox. Show which actions were sent, which failed, and which need checking in Figma before retrying. Do not copy the outbox into downloads.
- Keep the fetched comments JSON and Markdown as snapshots. Save stable identity fields in new snapshots, and show one linked checklist item per thread with nested replies in new Markdown. Older runs remain viewable and downloadable; fetch a fresh run to queue actions.
- Keep **Sync comments** pull-only. Pushing shows results on the current run without creating a new one. Use **Sync comments** and download the fresh run to share the latest Figma state.
- Keep the current Settings flow. Read-only tokens still work for fetching. An explicit push uses the saved token's account and requires `file_comments:write`; permission errors leave the unsent actions intact.

Out of scope: editing, deleting, resolving or unresolving comments through the app; adding new top-level comments; a public write CLI or importing an outbox; automatic push or refresh; changes to `title.txt`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `critique-viewer`: Display thread-level checklist state, review and manage pending actions, report delivery results, and exclude private outbox data from downloads.
- `critique-runner`: Preserve Figma thread identity, store run-local actions separately, and safely deliver an explicitly confirmed batch.
- `app-packaging`: Bundle the push script alongside the fetch and generate scripts.

## Impact

- **Comments and History:** The Comments toolbar and review controls, session state, and Tauri API bindings gain run-scoped actions and delivery status. Existing layout, navigation, and History remain available.
- **Scripts and native backend:** Fetch and generation gain thread metadata and grouping. A bundled Node script uses Figma's reply and reaction endpoints. The Tauri runner, run storage, and export path manage and protect the outbox.
- **Distribution and docs:** Update script staging and its checks for macOS and Windows. Document write scopes, queue behavior, and what downloads contain. No new runtime dependency or webview network permission is needed.
