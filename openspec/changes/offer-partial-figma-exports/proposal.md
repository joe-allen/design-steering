# Proposal

## Why

A Figma page scan can match a comment and then fail to read a different layer. Today that loses every match. A user who wants those comments should be able to keep them without mistaking an incomplete scan for a complete critique.

## What Changes

- Isolate persistent server errors while matching pins on the selected page. Keep matches from readable layers; identify the unreadable branches by their known layer paths and IDs.
- If at least one thread was matched, show **Save partial export** and **Discard**. Do not publish a run, replace the current critique, or add a History entry until the user saves it.
- Mark an accepted partial export in the viewer, History, and downloadable Markdown. A subsequent Sync starts a new scan; it never silently upgrades or overwrites the old result.
- Add a user-facing FAQ linked from README troubleshooting. Its first entry describes a former screenshot layer used only for a solid fill, how to recognize the symptom, and how to work around it without moving comments.
- Keep complete runs, the default CLI, authentication errors, and Figma writes unchanged. Do not skip image layers as a class or guess how many comments an unreadable branch contains.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `critique-runner`: distinguish a recoverable layer-read failure from a failed fetch; publish or discard the recoverable result explicitly.
- `critique-viewer`: present the decision and preserve the incomplete-scan warning wherever the saved critique is viewed or shared.

## Impact

The fetch worker, Markdown generator, Tauri run lifecycle, and Comments/History screens need a shared distinction between a complete result, a pending partial result, and an error. The comments JSON array and existing thread identities remain compatible. No new Figma scopes, runtime dependencies, or changes to the user's design are needed.
