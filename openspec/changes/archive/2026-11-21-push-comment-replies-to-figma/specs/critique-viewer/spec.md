# Spec Delta

## ADDED Requirements

### Requirement: Queue thread actions
Critiques SHALL open locked, with posted text read-only in both modes. Unlocking a writable run SHALL expose Reply and Done on each thread, without a separate thread picker. Users SHALL be able to edit unsent replies, queue one done-mark per root, and discard unsent actions whose result is known. Editing, relocking, and changing layout SHALL NOT send any action.

#### Scenario: Queue a reply on a thread
- **GIVEN** a thread has a root comment and several replies
- **WHEN** the user unlocks the critique, selects Reply beside that thread and types a nonblank reply
- **THEN** the draft appears directly under that thread, counts as one update, and nothing is posted

#### Scenario: Preserve drafts when locking or changing layout
- **GIVEN** a user has typed an unsent reply
- **WHEN** they switch between single and two-column layouts, or lock and unlock the same run
- **THEN** the same text remains with the same thread, without being sent or counted twice

#### Scenario: Cancel a queued done-mark
- **GIVEN** a done-mark is queued for a thread and has not been sent
- **WHEN** the user clears the pending mark
- **THEN** the mark is removed from the queue and no reaction is added or removed in Figma

#### Scenario: Read a run without push metadata
- **WHEN** a run without valid Figma thread metadata is opened
- **THEN** the critique remains readable and downloadable, and the app explains that a fresh run is needed to queue actions

### Requirement: Distinguish done from resolved
A check-mark reaction on the root comment by any Figma user SHALL count as done. The viewer SHALL distinguish pending done-marks from confirmed ones. It SHALL preserve Figma's separate "[Resolved]" label and SHALL NOT offer to remove posted reactions.

#### Scenario: Teammate marks a thread done
- **GIVEN** a thread on Figma has a check-mark reaction on the root comment from another user
- **WHEN** a fresh critique displays the thread
- **THEN** the thread shows as done without offering to queue an additional mark or to remove the reaction

#### Scenario: Done is not resolution
- **GIVEN** a thread was marked done but was not resolved in Figma
- **WHEN** the critique displays that thread
- **THEN** it shows the done state without the "[Resolved]" label

### Requirement: Review and confirm a batch
On an unlocked run, "Save N updates" SHALL replace "Sync comments" when there are actions ready to send. It SHALL open a review showing the destination, exact changes including reply text, and a notice that the saved token's account will be used. Only "Send to Figma" SHALL dispatch that reviewed batch.

#### Scenario: Review and cancel
- **GIVEN** two actions are queued on the displayed run
- **WHEN** the user opens the push review and cancels it
- **THEN** the same actions remain queued and no writes are sent

#### Scenario: No queue to push
- **WHEN** the displayed run has no actions ready to send
- **THEN** the toolbar shows "Sync comments" instead of a Save action

#### Scenario: Count actions rather than threads or keystrokes
- **GIVEN** the user drafts a reply and checks Done on the same thread
- **WHEN** they revise the reply
- **THEN** the toolbar still shows "Save 2 updates"; clearing the pending mark changes it to "Save 1 update", and discarding the reply restores "Sync comments"

### Requirement: Display delivery results
The Comments screen SHALL show push progress and retain action-level results on the original run. It SHALL distinguish confirmed, definitely rejected, and uncertain outcomes. It SHALL offer recovery for unsent actions without resending confirmed ones or silently retrying an uncertain action.

#### Scenario: Push partially succeeds
- **GIVEN** two queued replies are sent and only one succeeds
- **WHEN** the batch ends
- **THEN** the app shows which reply was sent and which failed, and only the definitely rejected reply is offered in the next push review

#### Scenario: Figma might have received a reply
- **WHEN** a reply attempt is interrupted without a definitive response
- **THEN** the action is marked as needing verification in Figma and is excluded from normal retries until the user explicitly acknowledges that they checked and wants to retry it

#### Scenario: Token lacks access
- **WHEN** the push is blocked by a missing token or Figma denies access
- **THEN** the app explains the relevant token or file access requirement, offers a way to open Settings, and keeps unsent actions

#### Scenario: Push is in progress
- **WHEN** a confirmed batch is being sent
- **THEN** the app shows push progress and prevents concurrent pushes, fetches, edits of the outbox, or deletion of the runs

### Requirement: Keep push and sync separate
Pushing SHALL NOT start a refresh run or write back into the generated critique. "Sync comments" SHALL only fetch and SHALL leave the original run and its outbox intact.

#### Scenario: Revisit local actions
- **GIVEN** there are queued or sent actions on a run
- **WHEN** the user reopens that run from History, including after relaunch
- **THEN** the app shows the recorded actions and statuses for that run

#### Scenario: Fetch while there are still pending actions
- **GIVEN** the user has locked the displayed run with actions still pending
- **WHEN** the user uses "Sync comments" and it succeeds
- **THEN** a fresh run is shown with no copied pending actions, nothing is posted, and the pending actions remain available on the earlier run in History

## MODIFIED Requirements

### Requirement: Rendered critique
When a run finishes or is opened, the Comments screen SHALL show "New page", "Download markdown", and a context-sensitive Sync or Save action above the scrollable critique. It SHALL preserve the headings, paragraphs, checklist items, frame images and numbered pin circles in both modes. New critiques SHALL contain one checklist item per Figma thread, with its pin number linked to the root comment and replies nested below it.

#### Scenario: Show the new run
- **WHEN** a run succeeds
- **THEN** the screen shows the toolbar and the rendered critique of that run, with each frame image above its comments in the default layout

#### Scenario: Resolved comments
- **GIVEN** a comment is resolved in Figma
- **WHEN** the critique is shown
- **THEN** that comment is marked "[Resolved]"

#### Scenario: Checklist reflects the fetched thread
- **GIVEN** a newly fetched thread has several replies and a check-mark reaction on its root
- **WHEN** the critique is generated
- **THEN** its Markdown has one checked item with a link to the root comment, and shows the replies beneath it without separate checkboxes

### Requirement: Download a run
The "Download markdown" action SHALL copy the fetched snapshot and its supporting files (Markdown, comments JSON, frame images, title if present, and source record if present) into a folder the user chooses, so the relative image links keep working. It SHALL NOT overwrite an existing folder or copy any outbox, local reply, or local delivery state.

#### Scenario: Successful download
- **WHEN** the user clicks "Download markdown" and chooses a destination folder
- **THEN** a copy of the snapshot and its supporting files is created inside it, and opening its markdown file shows the images

#### Scenario: Local changes are not exported
- **GIVEN** the run has queued replies and confirmed delivery results
- **WHEN** the user downloads the run without fetching a fresh snapshot
- **THEN** the outbox and its contents are absent from the download, and the exported Markdown and comments JSON reflect the original fetch

#### Scenario: Name already taken
- **GIVEN** the chosen destination already contains a folder with the run's name
- **WHEN** the copy is made
- **THEN** it is placed in a new folder with the next free numeric suffix and the existing folder is unchanged

#### Scenario: Cancelled
- **WHEN** the user cancels the folder chooser
- **THEN** nothing is copied and no error is shown
