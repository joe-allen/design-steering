# Spec Delta

## Purpose

Defines the Comments, History and download behavior of the app: starting a run, showing a generated critique safely as rendered markdown, browsing and searching past runs, and copying a run out of the app.

## ADDED Requirements

### Requirement: Navigation
The app SHALL have a sidebar with Comments, History and Settings, SHALL show the Comments screen on launch, and SHALL mark the current screen as active.

#### Scenario: Launch
- **WHEN** the app starts
- **THEN** the Comments screen is shown and its sidebar item is marked active

#### Scenario: Switch screens
- **WHEN** the user selects History in the sidebar
- **THEN** the History screen is shown and its sidebar item is marked active

### Requirement: Comments empty state
With no critique loaded, the Comments screen SHALL show a single "Get comments" action that starts a run.

#### Scenario: Start a run
- **GIVEN** valid settings are saved
- **WHEN** the user clicks "Get comments"
- **THEN** a run starts and the screen shows that it is in progress

### Requirement: Rendered critique
When a run finishes, the Comments screen SHALL show the generated markdown as rendered text with headings, paragraphs and checklist items, followed by the frame images of that run with their numbered pin circles, in a scrollable area.

#### Scenario: Show the new run
- **WHEN** a run succeeds
- **THEN** the screen shows the rendered critique of that run, with each frame image above its comments

#### Scenario: Resolved comments
- **GIVEN** a comment is resolved in Figma
- **WHEN** the critique is shown
- **THEN** that comment is marked "[Resolved]"

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
The download button SHALL copy the entire run folder (markdown, comments JSON and frame images) into a folder the user chooses, so the relative image links keep working, and SHALL NOT overwrite an existing folder.

#### Scenario: Successful download
- **WHEN** the user clicks download and chooses a destination folder
- **THEN** a copy of the run folder is created inside it, and opening its markdown file shows the images

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
