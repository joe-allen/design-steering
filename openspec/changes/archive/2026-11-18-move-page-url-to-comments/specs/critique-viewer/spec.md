# Spec Delta

## MODIFIED Requirements

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
When a run finishes or is opened, the Comments screen SHALL show a toolbar with "Sync comments", "Download markdown" and "New page" actions above the generated markdown, shown as rendered text with headings, paragraphs and checklist items, followed by the frame images of that run with their numbered pin circles, in a scrollable area.

#### Scenario: Show the new run
- **WHEN** a run succeeds
- **THEN** the screen shows the toolbar and the rendered critique of that run, with each frame image above its comments

#### Scenario: Resolved comments
- **GIVEN** a comment is resolved in Figma
- **WHEN** the critique is shown
- **THEN** that comment is marked "[Resolved]"

### Requirement: Download a run
The "Download markdown" action SHALL copy the entire run folder (markdown, comments JSON and frame images) into a folder the user chooses, so the relative image links keep working, and SHALL NOT overwrite an existing folder.

#### Scenario: Successful download
- **WHEN** the user clicks "Download markdown" and chooses a destination folder
- **THEN** a copy of the run folder is created inside it, and opening its markdown file shows the images

#### Scenario: Name already taken
- **GIVEN** the chosen destination already contains a folder with the run's name
- **WHEN** the copy is made
- **THEN** it is placed in a new folder with the next free numeric suffix and the existing folder is unchanged

#### Scenario: Cancelled
- **WHEN** the user cancels the folder chooser
- **THEN** nothing is copied and no error is shown

## ADDED Requirements

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
The "Sync comments" action SHALL start a new run for the page the displayed critique came from, using that run's recorded page URL and run name, and SHALL show the new run when it succeeds. If the displayed run has no readable record, it SHALL not start a run and SHALL tell the user to use "New page".

#### Scenario: Sync an opened run
- **GIVEN** a run for page A was opened from History and the last page entered on the form was page B
- **WHEN** the user clicks "Sync comments"
- **THEN** a run starts for page A, not page B, and the new run is displayed when it succeeds

#### Scenario: Sync keeps earlier runs
- **WHEN** a sync completes
- **THEN** the new run is in its own folder, the earlier run is unchanged, and both appear in History

#### Scenario: Run record unreadable
- **GIVEN** the displayed run's record is missing or unreadable
- **WHEN** the user clicks "Sync comments"
- **THEN** no run starts and a message tells the user to use "New page"

#### Scenario: Sync does not change the form
- **GIVEN** a sync ran for a page other than the last-used one
- **WHEN** the user later clicks "New page"
- **THEN** the URL input holds the last page URL entered on the form, not the synced page

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
