# critique-viewer Specification

## Purpose

Defines the Comments, History and download behavior of the app: starting a run, showing a generated critique safely as rendered markdown, browsing and searching past runs, and copying a run out of the app.

## Requirements

### Requirement: Navigation
The app SHALL have a sidebar with Comments, History and Settings, SHALL show the Comments screen on launch, and SHALL mark the current screen as active.

#### Scenario: Launch
- **WHEN** the app starts
- **THEN** the Comments screen is shown and its sidebar item is marked active

#### Scenario: Switch screens
- **WHEN** the user selects History in the sidebar
- **THEN** the History screen is shown and its sidebar item is marked active

### Requirement: Comments empty state
With no critique loaded, the Comments screen SHALL show the page input form instead of a bare action: a Figma page URL input, an optional run name input, and a "Get comments" action that starts a run. The URL input SHALL be pre-filled with the last page URL used for a run started from the form, and the run name input SHALL start empty.

#### Scenario: Start a run
- **GIVEN** a token is saved and a page URL is entered
- **WHEN** the user clicks "Get comments"
- **THEN** a run starts and the screen shows that it is in progress

#### Scenario: Form pre-filled
- **GIVEN** a page URL was used for an earlier run
- **WHEN** the Comments screen shows the form
- **THEN** the URL input holds that page URL and the run name input is empty

#### Scenario: First launch
- **GIVEN** no page URL has ever been used
- **WHEN** the app starts
- **THEN** the Comments screen shows the form with an empty URL input and no "Back to Comments" control

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

#### Scenario: Resume tabbing after viewing a frame image
- **GIVEN** the image viewer was opened from a frame image button
- **WHEN** the viewer is dismissed
- **THEN** focus returns to that button, even if opening it did not focus it, and Tab and Shift+Tab continue from there

### Requirement: Critique layout preference
The viewer SHALL provide a layout toggle, defaulting to single column, and SHALL remember the selected layout across navigation, runs, and app restarts. Layout changes SHALL NOT modify saved markdown, downloads, or content sanitization. Preference read or write failures SHALL be reported without preventing the critique from being viewed.

#### Scenario: First launch
- **GIVEN** no layout preference is saved
- **WHEN** a critique is shown
- **THEN** each frame image appears above its comments in a single column

#### Scenario: Wide two-column layout
- **GIVEN** two-column layout is selected and the critique container is wider than 1024px
- **WHEN** the critique is shown
- **THEN** CSS Grid places each image and its following comment list in the same row, with the image taking 60% and comments 40% of the space after the column gap

#### Scenario: Comments stay beside a tall image
- **GIVEN** the two-column grid is displayed
- **WHEN** the user scrolls through an image that is taller than its comment list
- **THEN** that comment list stays at the top of the critique area until the end of its image, then scrolls away before the next image's comments take its place

#### Scenario: Container becomes narrow
- **GIVEN** two-column layout is selected
- **WHEN** the critique container is 1024px wide or narrower, regardless of the window width
- **THEN** images stack above their comments without changing the selected preference, and two columns return when the container becomes wider than 1024px

#### Scenario: Reading direction
- **GIVEN** the two-column grid is displayed
- **WHEN** the inherited reading direction is right-to-left
- **THEN** comments appear on the right at inline-start and images on the left at inline-end; left-to-right reading reverses those positions

#### Scenario: Restore the layout selection
- **WHEN** the user selects a layout, closes the app, and reopens it
- **THEN** the selected layout is restored, subject to the same container-width rule

#### Scenario: Content without an image/comment pair
- **WHEN** a critique contains headings, General comments, or other unpaired blocks
- **THEN** those blocks remain full-width and nested comment content does not become separate grid cells

### Requirement: Safe rendering
The preview SHALL treat comment text and markdown as untrusted. It SHALL NOT run scripts, SHALL NOT load images or other content from remote addresses, and SHALL show only images that belong to the run being viewed.

#### Scenario: Hostile comment text
- **GIVEN** a Figma comment contains an HTML script tag or an event handler attribute
- **WHEN** the critique is shown
- **THEN** no script runs and the text is not able to call any app function

#### Scenario: Remote image in a comment
- **GIVEN** a comment's markdown references an image at a web address
- **WHEN** the critique is shown
- **THEN** no network request is made for that image

#### Scenario: Links
- **WHEN** the user clicks a link in the critique
- **THEN** the app does not navigate away from the critique; external links open in the system browser

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

### Requirement: Run history
The History screen SHALL list every completed run in the app's data folder, newest first, each labelled with its date and run name, and SHALL open a run's rendered critique when it is selected.

#### Scenario: List runs
- **GIVEN** three completed runs exist
- **WHEN** the user opens History
- **THEN** three entries are listed, newest first, each with its date and run name

#### Scenario: Open a past run
- **WHEN** the user selects an entry
- **THEN** the Comments screen shows that run's rendered critique with the download button available

#### Scenario: No runs yet
- **WHEN** no completed runs exist
- **THEN** History says there are no runs yet and suggests using "Get comments"

### Requirement: Search history
The History screen SHALL provide a search box that filters the list to entries whose date or name contains the typed text, ignoring case.

#### Scenario: Filter by name
- **GIVEN** entries named "checkout" and "home"
- **WHEN** the user types "check"
- **THEN** only the "checkout" entry is listed

#### Scenario: No matches
- **WHEN** the typed text matches no entry
- **THEN** the list is empty and says no runs match

### Requirement: New page
The "New page" action SHALL show the page input form in place of the critique and its toolbar, with a "Back to Comments" control that returns to the critique that was displayed. A run started from the form SHALL replace the displayed critique when it succeeds.

#### Scenario: Open the form
- **GIVEN** a critique is displayed
- **WHEN** the user clicks "New page"
- **THEN** the page input form is shown with a "Back to Comments" control in place of the toolbar

#### Scenario: Back to Comments
- **GIVEN** the form was opened with "New page"
- **WHEN** the user clicks "Back to Comments"
- **THEN** the previously displayed critique and its toolbar are shown again and nothing was fetched

#### Scenario: New page run replaces the critique
- **GIVEN** the form was opened with "New page" and a page URL and run name are entered
- **WHEN** the user clicks "Get comments" and the run succeeds
- **THEN** the new run's critique is displayed

#### Scenario: Failed run keeps the form
- **GIVEN** the form was opened with "New page"
- **WHEN** a run started from it fails
- **THEN** the error is shown, the form keeps what the user entered, and "Back to Comments" still returns to the earlier critique

### Requirement: Sync comments
The "Pull from Figma" action SHALL start a new run for the page the displayed critique came from, using that run's recorded page URL and run name, and SHALL show the new run when it succeeds. If the displayed run has no readable record, it SHALL not start a run and SHALL tell the user to use "New page".

#### Scenario: Sync an opened run
- **GIVEN** a run for page A was opened from History and the last page entered on the form was page B
- **WHEN** the user clicks "Pull from Figma"
- **THEN** a run starts for page A, not page B, and the new run is displayed when it succeeds

#### Scenario: Sync keeps earlier runs
- **WHEN** a sync completes
- **THEN** the new run is in its own folder, the earlier run is unchanged, and both appear in History

#### Scenario: Run record unreadable
- **GIVEN** the displayed run's record is missing or unreadable
- **WHEN** the user clicks "Pull from Figma"
- **THEN** no run starts and a message tells the user to use "New page"

#### Scenario: Sync does not change the form
- **GIVEN** a sync ran for a page other than the last-used one
- **WHEN** the user later clicks "New page"
- **THEN** the URL input holds the last page URL entered on the form, not the synced page

### Requirement: Review a partial export before saving
The desktop app SHALL offer **Save partial export** and **Discard** for a pending partial fetch or Sync. It SHALL show the number of confirmed threads, the known unreadable layer paths and IDs, and a notice that additional comments might be missing. Neither action SHALL modify Figma.

#### Scenario: Decision pending
- **WHEN** a partial candidate is ready
- **THEN** both actions are available, the incomplete candidate is not in History, and a second fetch, sync, or push cannot start before a decision

#### Scenario: Save the confirmed matches
- **WHEN** the user selects **Save partial export** and generation succeeds
- **THEN** the new partial critique opens and appears once in History; the previous run and any queued actions remain unchanged

#### Scenario: Discard from the form or from Sync
- **WHEN** the user selects **Discard**
- **THEN** no new critique is saved, the form or previously displayed run is restored as appropriate, and no prior run or outbox is deleted

#### Scenario: Close without accepting
- **WHEN** the user closes the app with a partial candidate awaiting a decision and reopens it
- **THEN** the unaccepted candidate is not published or offered as a saved run

### Requirement: Carry the incomplete-scan warning with the critique
An accepted partial run SHALL be labeled **Partial export** in History, its opened critique, and its downloaded Markdown. The warning in the critique and Markdown SHALL identify the unreadable layer paths and IDs, displayed as text, and SHALL distinguish confirmed matches from potentially missing comments.

#### Scenario: Reopen or share a partial run
- **WHEN** the user reopens the app, opens the partial run in either layout, or downloads it and reads the Markdown outside the app
- **THEN** the corresponding partial label remains visible, the confirmed threads remain available, and no local outbox content is exported

#### Scenario: Retry after repairing a layer
- **WHEN** a user selects **Sync comments** on a saved partial run and the new scan completes
- **THEN** the new run is not labeled partial and the original partial run retains its warning

#### Scenario: Legacy or complete run
- **WHEN** a user opens a complete run or a run saved before partial exports were supported
- **THEN** no partial label appears solely because the new metadata is absent

### Requirement: Remove runs
The History screen SHALL let the user remove a single run and SHALL let the user remove all runs at once. Each removal SHALL ask for confirmation before anything is deleted, and SHALL be unavailable while a run is in progress. Removing a run SHALL delete everything about it, as specified for run deletion, and the run SHALL disappear from the list and from search results.

#### Scenario: Remove one run
- **GIVEN** three runs are listed
- **WHEN** the user chooses to remove one and confirms
- **THEN** that run is deleted, two runs remain listed, and the others are unchanged

#### Scenario: Remove all runs
- **GIVEN** three runs are listed and a page URL is remembered
- **WHEN** the user chooses "Remove all" and confirms
- **THEN** all three runs are deleted, History says there are no runs yet, and the Comments form no longer has a pre-filled URL

#### Scenario: Cancelled
- **WHEN** the user cancels the confirmation
- **THEN** nothing is deleted and the list is unchanged

#### Scenario: Removing the displayed run
- **GIVEN** a run is displayed on the Comments screen
- **WHEN** that run is removed from History, individually or with "Remove all"
- **THEN** the Comments screen no longer shows it and shows the page input form

#### Scenario: Removal while running
- **WHEN** a run is in progress
- **THEN** the remove actions are disabled until the run finishes or fails

#### Scenario: Removal fails
- **GIVEN** a run's folder cannot be deleted
- **WHEN** the user confirms removal
- **THEN** the app shows an error naming the run that could not be removed, keeps it listed, and does not report success

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
On an unlocked run, "Save N updates" SHALL replace "Pull from Figma" when there are actions ready to send. It SHALL open a review showing the exact changes including reply text, and a notice that the saved token's account will be used, with a "Figma" link to the destination that opens in the system browser. Only "Send to Figma" SHALL dispatch that reviewed batch.

#### Scenario: Open the destination from the review
- **GIVEN** the push review is open
- **WHEN** the user clicks the "Figma" link in its notice
- **THEN** the destination opens in the system browser, the app does not navigate away, and the review stays open

#### Scenario: Review and cancel
- **GIVEN** two actions are queued on the displayed run
- **WHEN** the user opens the push review and cancels it
- **THEN** the same actions remain queued and no writes are sent

#### Scenario: No queue to push
- **WHEN** the displayed run has no actions ready to send
- **THEN** the toolbar shows "Pull from Figma" instead of a Save action

#### Scenario: Count actions rather than threads or keystrokes
- **GIVEN** the user drafts a reply and checks Done on the same thread
- **WHEN** they revise the reply
- **THEN** the toolbar still shows "Save 2 updates"; clearing the pending mark changes it to "Save 1 update", and discarding the reply restores "Pull from Figma"

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
Pushing SHALL NOT start a refresh run or write back into the generated critique. "Pull from Figma" SHALL only fetch and SHALL leave the original run and its outbox intact.

#### Scenario: Revisit local actions
- **GIVEN** there are queued or sent actions on a run
- **WHEN** the user reopens that run from History, including after relaunch
- **THEN** the app shows the recorded actions and statuses for that run

#### Scenario: Fetch while there are still pending actions
- **GIVEN** the user has locked the displayed run with actions still pending
- **WHEN** the user uses "Pull from Figma" and it succeeds
- **THEN** a fresh run is shown with no copied pending actions, nothing is posted, and the pending actions remain available on the earlier run in History
