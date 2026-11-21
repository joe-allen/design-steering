# Spec Delta

## ADDED Requirements

### Requirement: Preserve Figma thread identity
New comments JSON snapshots SHALL preserve the effective Figma file or branch key, comment ID, and parent comment ID (or no parent for a root) for each comment. They SHALL preserve enough reaction data to detect the done-mark on a root comment, while retaining the existing comment fields and JSON array shape.

#### Scenario: Fetch a branch with replies
- **GIVEN** a branch thread has a root comment and a reply that share the same displayed pin number
- **WHEN** the run fetches the branch
- **THEN** the snapshot identifies the branch, distinguishes each comment's ID, and records the reply's parent as the root ID

### Requirement: Keep the outbox private and run-local
The app SHALL persist queued actions and delivery results in the corresponding run folder separately from the fetched snapshot. The outbox SHALL NOT contain the Figma token. The app SHALL not export or copy the outbox to a new run, and removing the run SHALL remove its outbox without changing anything in Figma.

#### Scenario: Reopen a run after relaunch
- **GIVEN** an action has been queued or delivered
- **WHEN** the app is closed, reopened, and that run is selected from History
- **THEN** its outbox retains the action and status and is not merged into any other run

#### Scenario: Run removed
- **GIVEN** a run has both pending and delivered actions
- **WHEN** the user removes the run, individually or through "Remove all"
- **THEN** its outbox and any temporary copies are removed and no request is sent to Figma

### Requirement: Target only confirmed thread actions
The runner SHALL send only the reviewed actions after explicit confirmation. It SHALL validate the run's destination and each root comment, and target only the recorded Figma file or branch. It SHALL limit remote writes to posting replies and check-mark reactions on those roots.

#### Scenario: Reply to the original branch thread
- **GIVEN** a branch run has a queued reply for a thread with an existing reply
- **WHEN** the user confirms the batch
- **THEN** the runner posts a reply with the thread's root ID to the branch key, not the existing reply's ID or the base file's key

#### Scenario: Root already marked done
- **GIVEN** a teammate has added the check mark to the root since the run was saved
- **WHEN** the user confirms a batch containing a done-mark for that thread
- **THEN** the runner reports the action as already done without adding a reaction

#### Scenario: Destination or thread is invalid
- **WHEN** a queued action refers to a different file or branch, a reply rather than a root, or a root that no longer exists
- **THEN** the runner reports that the affected action could not be sent and does not redirect it to another thread or create a top-level comment

#### Scenario: Queue changes after review
- **WHEN** the contents of the reviewed batch differ from the current outbox at confirmation
- **THEN** no actions are sent until the user reviews and confirms the current batch

### Requirement: Checkpoint delivery per action
The runner SHALL record delivery attempts and outcomes per action. It SHALL not resend confirmed actions. An attempt whose outcome cannot be established SHALL be set aside for manual verification rather than retried automatically.

#### Scenario: Preserve partial success
- **GIVEN** Figma accepts a reply and rejects a later action in the batch
- **WHEN** the push finishes and the user confirms a retry of the rejected action
- **THEN** the accepted reply is not sent again

#### Scenario: Stop after uncertain delivery
- **WHEN** an attempt is interrupted after it may have reached Figma and no definitive result was saved
- **THEN** on reopening the run the attempt needs manual verification and later actions that were never attempted are still queued

### Requirement: Keep pushes separate from fetch permissions
Pushes SHALL use the saved token with access to the destination and the `file_comments:write` scope. The token SHALL be passed through the script's environment and SHALL NOT appear in arguments, logs, or run files. Fetch and Sync SHALL continue to work with read-only tokens.

#### Scenario: Figma refuses permission to write
- **GIVEN** the token can fetch the page but cannot write to it
- **WHEN** the user confirms a push
- **THEN** the runner reports the access error, preserves all unsent actions, and a later read-only Sync still works

## MODIFIED Requirements

### Requirement: Run source record
Each run folder SHALL contain a record of the page URL and run name the run was started with, written when the fetch succeeds, so the run can be synced later. The record SHALL NOT contain the token, and the fetch and generate scripts SHALL NOT need it. The recorded destination SHALL be checked against the snapshot before sending a batch.

#### Scenario: Record written
- **GIVEN** a run started with page URL A and run name "checkout"
- **WHEN** the run completes
- **THEN** its folder holds a record with page URL A and run name "checkout"

#### Scenario: Record without a run name
- **GIVEN** a run started with no run name
- **WHEN** the run completes
- **THEN** its record holds the page URL and an empty run name

#### Scenario: Token never recorded
- **GIVEN** a saved token
- **WHEN** a run completes
- **THEN** the token text appears nowhere in the run's record

#### Scenario: Record travels with the run
- **WHEN** the user downloads a run
- **THEN** the copied folder includes the record, and the markdown, JSON and images are unaffected by it

#### Scenario: Record cannot be written
- **WHEN** the record cannot be written after a successful fetch
- **THEN** the run fails with an error message and does not appear in History

#### Scenario: Source and snapshot do not agree
- **WHEN** a batch is requested for a run with a missing, invalid, or inconsistent source record
- **THEN** no write is made, the queue is preserved, and the app explains that a fresh run is needed
