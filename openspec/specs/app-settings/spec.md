# app-settings Specification

## Purpose

Defines the Settings screen and the values it persists, which mirror the options of the existing command-line scripts, and how the Figma token is stored and protected.

## Requirements

### Requirement: Settings fields
The Settings screen SHALL provide a field for the Figma personal access token, toggles for including frame images (default on) and showing the comment author (default off), and an optional Node path. It SHALL NOT provide fields for the Figma page URL or the run name, which are entered on the Comments screen.

#### Scenario: First launch defaults
- **GIVEN** the app has never been configured
- **WHEN** the user opens Settings
- **THEN** the token and Node path are empty, the images toggle is on and the author toggle is off

#### Scenario: No page fields
- **WHEN** the user opens Settings
- **THEN** there is no field for the Figma page URL or the run name

### Requirement: Settings persist
Saving SHALL store all Settings values so they are restored after the app is closed and reopened, and SHALL NOT change the last page URL remembered by the Comments screen.

#### Scenario: Save and relaunch
- **WHEN** the user enters a token, changes the toggles, saves, quits and reopens the app
- **THEN** Settings shows the same toggle states and a token field that is populated but masked

#### Scenario: Save confirmation
- **WHEN** the user saves
- **THEN** the app confirms the save, or shows an error if the settings could not be written

#### Scenario: Saving keeps the remembered page
- **GIVEN** a page URL was used for a run on the Comments screen
- **WHEN** the user saves Settings
- **THEN** the Comments form is still pre-filled with that page URL

### Requirement: Token handling
The token field SHALL be masked and SHALL provide a way to clear the saved token. The token SHALL be stored only in the app's settings file and SHALL NOT appear in any log pane, run folder, generated markdown, or history label.

#### Scenario: Token never shown after entry
- **GIVEN** a saved token
- **WHEN** a run completes and the user views its output, history entry and log
- **THEN** the token text appears in none of them

#### Scenario: Clear token
- **WHEN** the user clears the token and saves
- **THEN** no token remains stored and the next run asks for one

### Requirement: Required values before a run
A run SHALL NOT start while the token or page URL is empty. A missing token SHALL be reported with a message that directs the user to Settings, and a missing page URL SHALL be reported on the Comments screen next to the URL input.

#### Scenario: Missing token
- **GIVEN** a page URL is entered but no token is saved
- **WHEN** the user clicks "Get comments"
- **THEN** no run starts and a message says the Figma token is missing and points to Settings

#### Scenario: Missing page URL
- **GIVEN** a token is saved and the page URL input is empty
- **WHEN** the user clicks "Get comments"
- **THEN** no run starts and a message next to the input says the Figma page URL is missing

### Requirement: Settings map to script options
Each Settings value and each Comments input SHALL correspond to exactly one existing script option: page URL and run name from Comments, and token, images toggle and author toggle from Settings.

#### Scenario: Run name used as folder name
- **GIVEN** the run name "checkout" is entered on the Comments screen
- **WHEN** a run completes
- **THEN** the run folder is named `checkout-design-critique` (or its next free numbered form)

#### Scenario: Images off
- **GIVEN** the images toggle is off
- **WHEN** a run completes
- **THEN** no frame images are exported, the run still succeeds, and the preview lists every comment under "General comments" without images

#### Scenario: Author shown
- **GIVEN** the author toggle is on
- **WHEN** a run completes
- **THEN** each comment in the generated markdown is followed by its author's handle in parentheses

### Requirement: App version shown
The Settings screen SHALL show the version of the running app, as "Version" followed by the version number.

#### Scenario: Installed release
- **GIVEN** the 0.1.0 release is installed
- **WHEN** the user opens Settings
- **THEN** it shows "Version 0.1.0"

#### Scenario: After upgrading
- **GIVEN** a user upgrades from 0.1.0 to 0.2.0 by installing the newer build
- **WHEN** they open Settings
- **THEN** it shows "Version 0.2.0"
