# Design

## Context

The fetch worker already reads page layers in batches of eight, three levels per request. It can resolve a pin from the page outline before asking Figma for the layers inside a different frame. Today a persistent error exits the worker and loses those matches. The desktop runner expects a run-directory path, generates Markdown, and returns a run ID; the viewer opens that ID immediately. History treats the presence of `<run-id>.md` as completion.

## Goals / Non-Goals

Keep confirmed results without weakening page membership, thread identity, or the distinction between pending and published runs. Do not change the user's Figma file, infer missing pins from screen coordinates, suppress image layers, or change the default CLI contract.

## Decisions

1. **Recover only inside the selected page's pin-matching loop.** Give desktop fetch an explicit opt-in mode. Preserve status and operation in a typed fetch error rather than parsing stderr. After the normal retry for a 500/502/503/504, bisect a failing batch and process the successful halves. For a failing singleton, try a shallower read once if that would reduce the depth. On success, walk the returned children using the actual depth of that read. On persistent failure, stop descending that branch, record its known ancestry and ID, and continue with the other branches. A branch failing to expand does not invalidate a pin already matched to that branch's root.
2. **Bound extra work and make uncertainty visible.** Keep node IDs deduplicated and limit recovery reads per scan, including retries. If the recovery budget runs out, distinguish branches not checked from branches confirmed unreadable. Do not drop an entire failed batch as though every member were bad. Keep the current error path for authentication, rate limits after retry, page resolution, the comments feed, and unrelated errors. A partial result requires a confirmed page thread; the number of file-wide unmatched anchors is not a count of missing page comments.
3. **Stage before asking; publish once.** Replace the desktop `start_run` return value with a tagged result: completed run ID or pending partial ID and summary. Keep candidate files in an app-private staging area outside the History collection; retain no token. Rust owns the pending ID and accepts Save or Discard only for its live candidate, never for a frontend-supplied path. Hold the existing single-operation guard across the decision. On Save, select a free final basename using the existing suffix convention, align JSON and Markdown names with that basename, write the source record, generate locally, then publish without overwriting. On Discard or failure, clean up the candidate; after restart, clean up abandoned staging, never promote it. This avoids refetching changed comments on Save or temporarily leaking an unapproved run into History.
4. **Keep the warning attached to the snapshot.** Store a versioned partial-scan report with a saved partial run, separate from the unchanged comments array and the private outbox. Use it for the History label, review details, and generator warning near the top of the Markdown. Escape layer names as untrusted text. The downloaded Markdown carries the warning even outside the app; no need to broaden the snapshot copier to include staging or outbox files. Legacy runs lack a report; a present but invalid report is an error, not proof of a complete scan. **Sync comments** retries by taking a new snapshot, not by merging results into the old one.

## FAQ draft

Publish the following as the first entry in a root `FAQ.md`, linked from README troubleshooting:

### Why can a comment fetch fail on a layer that looks like a solid color?

Figma can return the comment and list the frame it belongs to, then return a server error when the app tries to read the layers inside another frame. That does not mean your comment is too deeply nested.

In one design, a screenshot layer had been kept as a colored shape after its image was removed. Removing those former image layers let the fetch finish. Figma did not report why they failed; this is not a general problem with image fills, and a screenshot-style layer name alone does not identify a bad layer.

Use the reported layer path to find the affected branch. If a former image layer is only providing a background, try replacing it with a new solid rectangle or putting the fill on the enclosing frame. Test the edit in a copy or keep it undoable. There is no need to flatten the design or move a working comment pin.

If the app offers **Save partial export**, it has confirmed some threads but could not check the whole page. Save to keep those matches with a warning, or choose **Discard** to save nothing. After repairing the layer, fetch again (or **Sync comments** from the saved run) for a fresh scan.

## Risks / Trade-offs

- **A transient outage can resemble several bad branches.** Bound recovery, honor rate limits, describe what the scan observed, and never diagnose file corruption from HTTP status.
- **Duplicate layer names make a path ambiguous.** Display the ID alongside the readable path; never publish private file keys, tokens, or customer-specific names in the public FAQ.
- **An interrupted decision could publish twice or destroy prior work.** Validate one-use pending IDs, keep staging and published storage separate, and test repeat decisions, collisions, and generation failures.

## Migration Plan

Ship the fetch/generate scripts, Rust runner, and UI together through normal desktop staging. No backfill is needed. To roll back, disable desktop opt-in and return to strict fetches; already-saved partial Markdown retains its warning.
